"""Web app: serves the UI, the REST API (RBAC + family-scoped) and mounts the MCP server at /mcp (bearer-token protected)."""
from __future__ import annotations

import json
import logging
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request  # noqa: E402
from fastapi.responses import JSONResponse, Response, StreamingResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from . import admin, agent, audit, auth, db, prescription, service, tts  # noqa: E402
from .mcp_server import AuthMiddleware, mcp  # noqa: E402

log = logging.getLogger("carecircle")
ROOT = Path(__file__).resolve().parents[2]
STATIC = ROOT / "web" / "dist" if (ROOT / "web" / "dist").exists() else ROOT / "static"
db.init()
mcp_app = mcp.streamable_http_app()


@asynccontextmanager
async def lifespan(_: FastAPI):
    audit.purge()
    async with mcp.session_manager.run():
        yield
    agent.shutdown()


app = FastAPI(title="CareCircle", lifespan=lifespan)
app.mount("/mcp", AuthMiddleware(mcp_app))


@app.exception_handler(admin.AdminError)
async def admin_error(_: Request, e: admin.AdminError):
    return JSONResponse(status_code=e.status, content={"detail": e.message})


# ---------------------------------------------------------------- auth plumbing
def current_actor(authorization: str | None = Header(default=None)) -> auth.Actor:
    actor = auth.verify_token(auth.bearer(authorization))
    if actor is None:
        raise HTTPException(401, "Sign in required")
    return actor


def require(perm: str):
    """FastAPI dependency: signed in AND holds `perm`. Denials are audited."""
    def dep(actor: auth.Actor = Depends(current_actor)) -> auth.Actor:
        if not actor.can(perm):
            audit.record(actor, "api:denied", perm, outcome="denied")
            raise HTTPException(403, f"A {actor.role} account is not allowed to do this ({perm})")
        return actor
    return dep


class Ctx:
    """The signed-in account plus the ONE patient this request is about (already checked against the account's access)."""

    def __init__(self, actor: auth.Actor, pid: str):
        self.actor, self.pid = actor, pid


def patient_ctx(perm: str | None):
    def dep(patient_id: str | None = Query(default=None), actor: auth.Actor = Depends(current_actor)) -> Ctx:
        if perm and not actor.can(perm):
            audit.record(actor, "api:denied", perm, outcome="denied")
            raise HTTPException(403, f"A {actor.role} account is not allowed to do this ({perm})")
        pid = patient_id or (actor.patients[0] if len(actor.patients) == 1 else None)
        if not pid:
            raise HTTPException(422, "patient_id is required")
        if not actor.can_access(pid):
            audit.record(actor, "api:denied", f"patient:{pid}", outcome="denied", patient_id=None)
            raise HTTPException(404, "Not found")              # another family's patient looks exactly like a missing one
        return Ctx(actor, pid)
    return dep


class LoginIn(BaseModel):
    username: str
    password: str


class PasswordIn(BaseModel):
    current_password: str
    new_password: str


class ChatIn(BaseModel):
    message: str
    session_id: str | None = None
    language: str = "en-IN"


class DoseIn(BaseModel):
    medication: str
    status: str = "taken"
    slot: str | None = None


class VitalIn(BaseModel):
    kind: str
    value: float
    value2: float | None = None


class AppointmentIn(BaseModel):
    title: str
    starts_at: str
    doctor: str = ""
    location: str = ""
    needs_ride: bool = False
    notes: str = ""
    facility_id: int | None = None


class TtsIn(BaseModel):
    text: str
    language: str


class ScenarioIn(BaseModel):
    name: str = "decline"


# ---------------------------------------------------------------- public
@app.get("/api/health")
def health():
    """Public liveness probe. Deliberately says nothing about models, providers, regions or keys."""
    return {"ok": True, "demo_auth": auth.demo_auth_enabled()}


@app.get("/api/system")
def system(actor: auth.Actor = Depends(require("audit:read"))):
    """Implementation details for the hidden Developer view. Family admins only; never part of the normal product UI."""
    return {"assistant_model": agent.MODEL_ID, "region": agent.REGION, "assistant_ready": bool(os.environ.get("AWS_BEARER_TOKEN_BEDROCK")),
            "mcp_protocol": "2025-11-25 (Streamable HTTP)", "voice": "Amazon Polly" if tts.polly_configured() else "device voices"}


@app.get("/api/languages")
def languages():
    return [{"code": c, "name": n, "native": nat} for c, (n, nat) in agent.LANGUAGES.items()]


@app.get("/api/voices")
def voices():
    """Languages the server can speak itself (empty unless a server voice is configured). Provider-neutral on purpose."""
    langs = tts.available_languages()
    return {"server_languages": langs, "preferred": langs, "engines": {l: "server" for l in langs}, "engine": "server"}


# ---------------------------------------------------------------- sign-in
@app.get("/api/auth/demo-accounts")
def demo_accounts():
    """Directory for the sign-in page (demo only): who exists and, while still the default, their demo password."""
    if not auth.demo_auth_enabled():
        raise HTTPException(404, "Demo sign-in is disabled")
    return auth.demo_accounts()


@app.post("/api/auth/login")
def login(body: LoginIn):
    try:
        actor = auth.login(body.username, body.password)
    except auth.LoginError as e:
        audit.record(None, "auth:login", (body.username or "")[:40], outcome="denied", args={"reason": e.kind})
        if e.kind == "locked":
            raise HTTPException(429, f"Too many failed attempts. Try again in {auth.LOCK_SECONDS} seconds.")
        raise HTTPException(401, "Wrong username or password")
    audit.record(actor, "auth:login")
    return {"token": auth.make_token(actor), "user": actor.public()}


@app.get("/api/auth/me")
def me(actor: auth.Actor = Depends(current_actor)):
    out = actor.public()
    out["patients_overview"] = service.patients_overview(actor)
    return out


@app.post("/api/auth/password")
def change_password(body: PasswordIn, actor: auth.Actor = Depends(current_actor)):
    try:
        auth.login(actor.id, body.current_password)
    except auth.LoginError:
        audit.record(actor, "auth:change_password", outcome="denied")
        raise HTTPException(401, "Current password is wrong")
    try:
        auth.set_password(actor.id, body.new_password)
    except ValueError as e:
        raise HTTPException(422, str(e))
    audit.record(actor, "auth:change_password")
    return {"ok": True}


# ---------------------------------------------------------------- care record (one patient per request)
@app.get("/api/patients")
def patients(actor: auth.Actor = Depends(current_actor)):
    return service.patients_overview(actor)


@app.get("/api/snapshot")
def snapshot(ctx: Ctx = Depends(patient_ctx("snapshot:read"))):
    return service.snapshot_for(ctx.actor, ctx.pid)


@app.post("/api/dose")
def dose(body: DoseIn, ctx: Ctx = Depends(patient_ctx("dose:log"))):
    res = service.log_dose(ctx.pid, body.medication, body.status, body.slot)
    audit.record(ctx.actor, "api:log_dose", body.medication, "allowed" if res.get("ok") else "rejected", patient_id=ctx.pid)
    if not res.get("ok"):
        raise HTTPException(400, res.get("error"))
    return res


@app.post("/api/vitals")
def vitals(body: VitalIn, ctx: Ctx = Depends(patient_ctx("vital:write"))):
    res = service.record_vital(ctx.pid, body.kind, body.value, body.value2)
    audit.record(ctx.actor, "api:record_vital", body.kind, "allowed" if res.get("ok") else "rejected", patient_id=ctx.pid)
    if not res.get("ok"):
        raise HTTPException(400, res.get("error"))
    return res


@app.post("/api/appointments")
def add_appointment(body: AppointmentIn, ctx: Ctx = Depends(patient_ctx("appointment:write"))):
    res = service.schedule_appointment(ctx.pid, body.title, body.starts_at, body.doctor, body.location, body.needs_ride, body.notes, body.facility_id)
    audit.record(ctx.actor, "api:add_appointment", body.title, "allowed" if res.get("ok") else "rejected", patient_id=ctx.pid)
    if not res.get("ok"):
        raise HTTPException(422, res.get("error"))
    return res


@app.post("/api/alerts/{alert_id}/resolve")
def resolve(alert_id: int, actor: auth.Actor = Depends(require("alert:resolve"))):
    pid = service.alert_patient(alert_id)
    if not pid or not actor.can_access(pid):
        raise HTTPException(404, "Not found")
    audit.record(actor, "api:resolve_alert", str(alert_id), patient_id=pid)
    return service.resolve_alert(pid, alert_id, f"Resolved by {actor.name} from the family dashboard")


# ---------------------------------------------------------------- agent (streaming + plain)
ASSISTANT_DOWN = "The assistant is unavailable right now. Please try again in a moment."


def _llm_error(e: Exception) -> JSONResponse:
    """Details (exception type, account ids, ARNs) go to the server log, never to the user."""
    log.exception("assistant call failed: %s", type(e).__name__)
    return JSONResponse(status_code=502, content={"error": ASSISTANT_DOWN})


def chat_ctx(patient_id: str | None = Query(default=None), actor: auth.Actor = Depends(current_actor)) -> Ctx:
    perm = "chat:person" if actor.role == "person" else "chat:family"
    return patient_ctx(perm)(patient_id, actor)


def _sse(gen):
    async def body():
        async for ev in gen:
            yield f"data: {json.dumps(ev, default=str)}\n\n"
    return StreamingResponse(body(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


async def _persisted(ctx: Ctx, message: str, session_id: str | None, language: str, audit_action: str):
    """Run the agent for ONE patient, store the conversation (text + tool names only) and audit the request."""
    actor, pid = ctx.actor, ctx.pid
    session_id = session_id or uuid.uuid4().hex[:8]
    conv = f"{actor.id}:{pid}:{session_id}"
    try:
        audit.start_or_touch(conv, actor, agent.role_for(actor), language, pid)
    except PermissionError:
        yield {"type": "error", "message": "That conversation belongs to someone else."}
        return
    audit.record(actor, audit_action, conv, patient_id=pid)
    audit.add_message(conv, "user", message)
    tools: list[str] = []
    async for ev in agent.stream(actor, pid, message, session_id, language):
        if ev["type"] == "tool_result":
            tools.append(ev["tool"])
        elif ev["type"] == "done":
            audit.add_message(conv, "assistant", ev["reply"], tools)
        yield ev


@app.post("/api/chat/stream")
def chat_stream(body: ChatIn, ctx: Ctx = Depends(chat_ctx)):
    return _sse(_persisted(ctx, body.message, body.session_id, body.language, "api:chat"))


@app.post("/api/care-watch/stream")
def care_watch_stream(ctx: Ctx = Depends(patient_ctx("agent:run"))):
    return _sse(_persisted(ctx, agent.CARE_WATCH_PROMPT, f"watch-{uuid.uuid4().hex[:6]}", "en-IN", "api:care_watch"))


@app.post("/api/digest/stream")
def digest_stream(ctx: Ctx = Depends(patient_ctx("agent:run"))):
    return _sse(_persisted(ctx, agent.DIGEST_PROMPT, f"digest-{uuid.uuid4().hex[:6]}", "en-IN", "api:digest"))


@app.post("/api/chat")
def chat(body: ChatIn, ctx: Ctx = Depends(chat_ctx)):
    audit.record(ctx.actor, "api:chat", "plain", patient_id=ctx.pid)
    try:
        return agent.chat(ctx.actor, ctx.pid, body.message, body.session_id, body.language)
    except Exception as e:  # noqa: BLE001 - surface model/credential problems to the UI instead of a blank 500
        return _llm_error(e)


@app.post("/api/care-watch")
def care_watch(ctx: Ctx = Depends(patient_ctx("agent:run"))):
    audit.record(ctx.actor, "api:care_watch", "plain", patient_id=ctx.pid)
    try:
        return agent.care_watch(ctx.actor, ctx.pid)
    except Exception as e:  # noqa: BLE001
        return _llm_error(e)


@app.post("/api/digest")
def digest(ctx: Ctx = Depends(patient_ctx("agent:run"))):
    audit.record(ctx.actor, "api:digest", "plain", patient_id=ctx.pid)
    try:
        return agent.family_digest(ctx.actor, ctx.pid)
    except Exception as e:  # noqa: BLE001
        return _llm_error(e)


# ---------------------------------------------------------------- audit + conversations
@app.get("/api/audit")
def audit_log(limit: int = 100, actor: auth.Actor = Depends(require("audit:read"))):
    return audit.recent(actor, limit)


@app.get("/api/conversations")
def conversations(patient_id: str | None = None, actor: auth.Actor = Depends(current_actor)):
    return audit.list_conversations(actor, patient_id if patient_id and actor.can_access(patient_id) else None)


@app.get("/api/conversations/{conv_id:path}")
def conversation(conv_id: str, actor: auth.Actor = Depends(current_actor)):
    msgs = audit.get_conversation(conv_id, actor)
    if msgs is None:                       # same answer for "missing" and "not yours": do not reveal what exists
        raise HTTPException(404, "Not found")
    audit.record(actor, "conversation:read", conv_id)
    return msgs


@app.delete("/api/conversations")
def delete_my_conversations(actor: auth.Actor = Depends(require("conversation:delete_own"))):
    return {"deleted": audit.delete_own(actor)}


# ---------------------------------------------------------------- family administration (scoped to the caller's own family)
@app.get("/api/admin/overview")
def admin_overview(actor: auth.Actor = Depends(require("members:manage"))):
    return admin.overview(actor)


class MemberIn(BaseModel):
    name: str
    username: str
    role: str = "family"
    phone: str | None = None
    notify_level: str = "urgent"
    password: str
    patient_id: str | None = None


@app.post("/api/admin/members", status_code=201)
def admin_add_member(body: MemberIn, actor: auth.Actor = Depends(require("members:manage"))):
    return admin.add_member(actor, body.name, body.username, body.role, body.phone, body.notify_level, body.password, body.patient_id)


@app.patch("/api/admin/members/{user_id}")
def admin_update_member(user_id: str, changes: dict, actor: auth.Actor = Depends(require("members:manage"))):
    out = admin.update_member(actor, user_id, changes)
    if "role" in changes or "active" in changes:
        agent.drop_connections(user_id)
    return out


@app.delete("/api/admin/members/{user_id}")
def admin_remove_member(user_id: str, actor: auth.Actor = Depends(require("members:manage"))):
    out = admin.remove_member(actor, user_id)
    agent.drop_connections(user_id)
    return out


@app.post("/api/admin/patients", status_code=201)
def admin_add_patient(data: dict, actor: auth.Actor = Depends(require("patients:manage"))):
    return admin.add_patient(actor, data)


@app.patch("/api/admin/patients/{pid}")
def admin_update_patient(pid: str, changes: dict, actor: auth.Actor = Depends(current_actor)):
    return admin.update_patient(actor, pid, changes)


@app.delete("/api/admin/patients/{pid}")
def admin_archive_patient(pid: str, actor: auth.Actor = Depends(require("patients:manage"))):
    out = admin.archive_patient(actor, pid)
    for u in db.rows("SELECT id FROM users WHERE patient_id=?", (pid,)):
        agent.drop_connections(u["id"])
    return out


@app.post("/api/admin/patients/{pid}/medications", status_code=201)
def admin_add_med(pid: str, data: dict, actor: auth.Actor = Depends(require("meds:manage"))):
    return admin.add_medication(actor, pid, data)


class ScanIn(BaseModel):
    filename: str = ""          # accepted for the UI's convenience; never stored or logged
    media_type: str = ""        # ignored: the file's own bytes decide what it is
    data: str


@app.post("/api/admin/patients/{pid}/prescription/scan")
def admin_scan_prescription(pid: str, body: ScanIn, actor: auth.Actor = Depends(require("meds:manage"))):
    """Read a prescription photo/PDF and return DRAFT medicines for a human to review. Nothing is saved and the upload is discarded."""
    admin._own_patient(actor, pid)                                  # 404 for another family's patient, before anything is sent to a model
    try:
        res = prescription.scan(pid, body.data)
    except prescription.ScanError as e:
        audit.record(actor, "admin:scan_prescription", pid, outcome="rejected", args={"reason": e.message[:80]}, patient_id=pid)
        raise HTTPException(e.status, e.message)
    audit.record(actor, "admin:scan_prescription", pid, args={"format": res["meta"]["format"], "bytes": res["meta"]["bytes"], "items": len(res["items"])}, patient_id=pid)
    return res


@app.post("/api/admin/patients/{pid}/prescription/apply")
def admin_apply_prescription(pid: str, data: dict, actor: auth.Actor = Depends(require("meds:manage"))):
    return admin.apply_prescription(actor, pid, data)


@app.patch("/api/admin/medications/{med_id}")
def admin_update_med(med_id: int, changes: dict, actor: auth.Actor = Depends(require("meds:manage"))):
    return admin.update_medication(actor, med_id, changes)


@app.delete("/api/admin/medications/{med_id}")
def admin_stop_med(med_id: int, actor: auth.Actor = Depends(require("meds:manage"))):
    return admin.stop_medication(actor, med_id)


@app.patch("/api/admin/appointments/{appt_id}")
def admin_update_appointment(appt_id: int, changes: dict, actor: auth.Actor = Depends(require("appointments:manage"))):
    return admin.update_appointment(actor, appt_id, changes)


@app.delete("/api/admin/appointments/{appt_id}")
def admin_cancel_appointment(appt_id: int, actor: auth.Actor = Depends(require("appointments:manage"))):
    return admin.cancel_appointment(actor, appt_id)


@app.post("/api/admin/facilities", status_code=201)
def admin_add_facility(data: dict, actor: auth.Actor = Depends(require("facilities:manage"))):
    return admin.add_facility(actor, data)


@app.patch("/api/admin/facilities/{fid}")
def admin_update_facility(fid: int, changes: dict, actor: auth.Actor = Depends(require("facilities:manage"))):
    return admin.update_facility(actor, fid, changes)


@app.delete("/api/admin/facilities/{fid}")
def admin_remove_facility(fid: int, actor: auth.Actor = Depends(require("facilities:manage"))):
    return admin.remove_facility(actor, fid)


# ---------------------------------------------------------------- voice + demo controls
@app.post("/api/tts")
def tts_speak(body: TtsIn, actor: auth.Actor = Depends(current_actor)):
    try:
        audio, media = tts.synthesize(body.text, body.language)
        return Response(audio, media_type=media, headers={"Cache-Control": "private, max-age=3600"})
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:                    # not configured / provider refused: say so privately, tell the user only that voice is unavailable
        log.warning("text-to-speech unavailable: %s", e)
        raise HTTPException(503, "Voice is unavailable right now.")
    except Exception as e:  # noqa: BLE001 - e.g. voice service access denied
        log.exception("text-to-speech failed: %s", type(e).__name__)
        return JSONResponse(status_code=502, content={"error": "Voice is unavailable right now."})


@app.post("/api/demo/reset")
def reset(body: ScenarioIn | None = None, actor: auth.Actor = Depends(require("demo:reset"))):
    """Regenerate the demo data for the caller's OWN family only; other families are untouched."""
    if not auth.demo_auth_enabled():
        raise HTTPException(404, "Demo controls are disabled")
    name = body.name if body else "decline"
    try:
        db.reset(name, actor.family_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    for key in [k for k in agent._sessions if any(f":{p}:" in k for p in actor.patients)]:
        agent._sessions.pop(key, None)
    audit.record(actor, "demo:reset", name)
    return {"ok": True, "scenario": name}


app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")


def main() -> None:
    import uvicorn
    uvicorn.run("carecircle.app:app", host="127.0.0.1", port=int(os.environ.get("PORT", 8000)), log_level="info")


if __name__ == "__main__":
    main()
