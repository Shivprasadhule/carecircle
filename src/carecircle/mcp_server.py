"""CareCircle MCP server (spec 2025-11-25, Streamable HTTP).

This is the Alexa+ integration surface: Alexa+ (or any MCP client) discovers
these tools and orchestrates them in conversation. State persists across
sessions in SQLite, so CareCircle "remembers" the person it looks after.
"""
from __future__ import annotations

import functools
import json

from mcp.server.fastmcp import FastMCP
from starlette.responses import JSONResponse

from . import audit, auth, service

INSTRUCTIONS = """\
CareCircle helps a family look after an older loved one by voice.
Be warm, brief and unhurried. Never diagnose; describe patterns and suggest
talking to the doctor. Use recall_memories at the start of a conversation so
you address the person the way they like. Always log what you learn
(doses, mood, sleep, pain) with the matching tool. When signals look worrying,
explain them to the person gently and, if appropriate, raise a family alert.
"""

mcp = FastMCP(
    "CareCircle",
    instructions=INSTRUCTIONS,
    streamable_http_path="/",
    stateless_http=True,
    json_response=True,
)


def _pid() -> str | None:
    return auth.current_patient.get()


def guarded(fn):
    """RBAC for an MCP tool. The permission comes from auth.TOOL_PERMS and is checked on EVERY call, whatever the model decides.
    The patient is NOT a tool argument: it is fixed by the connection (X-Patient-Id, validated against the account's access), so
    the model can never read or write another patient's record. Denied calls come back as normal tool results and are audited."""
    perm = auth.TOOL_PERMS[fn.__name__]

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        actor, pid = auth.current_actor.get(), _pid()
        if actor is None:
            audit.record(None, f"tool:{fn.__name__}", outcome="denied", args=kwargs)
            return {"ok": False, "error": "Not signed in."}
        if not actor.can(perm):
            audit.record(actor, f"tool:{fn.__name__}", outcome="denied", args=kwargs, patient_id=pid)
            return {"ok": False, "error": f"Not allowed: a {actor.role} account cannot do this ({perm}). Explain this kindly and suggest who can."}
        if not pid or not actor.can_access(pid):
            audit.record(actor, f"tool:{fn.__name__}", outcome="denied", args=kwargs, patient_id=pid)
            return {"ok": False, "error": "No patient is selected for this conversation."}
        try:
            result = fn(*args, **kwargs)
        except Exception as e:  # noqa: BLE001
            audit.record(actor, f"tool:{fn.__name__}", outcome="error", args=kwargs, patient_id=pid)
            raise e
        ok = not (isinstance(result, dict) and result.get("ok") is False)
        audit.record(actor, f"tool:{fn.__name__}", outcome="allowed" if ok else "rejected", args=kwargs, patient_id=pid)
        return result

    return wrapper


class AuthMiddleware:
    """Pure-ASGI guard for the /mcp endpoint: no valid bearer token, no MCP (HTTP 401). Binds the connection to one patient."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = {k.decode().lower(): v.decode() for k, v in scope["headers"]}
        actor = auth.verify_token(auth.bearer(headers.get("authorization")))
        if actor is None:
            audit.record(None, "mcp:connect", outcome="denied")
            res = JSONResponse({"error": "unauthorized", "detail": "Valid bearer token required"}, status_code=401)
            return await res(scope, receive, send)
        requested = headers.get("x-patient-id")
        if requested and not actor.can_access(requested):
            audit.record(actor, "mcp:connect", requested, outcome="denied")          # another family's patient, or an unknown id
            res = JSONResponse({"error": "forbidden", "detail": "No access to that patient"}, status_code=403)
            return await res(scope, receive, send)
        pid = requested or (actor.patients[0] if len(actor.patients) == 1 else None)
        t1, t2 = auth.current_actor.set(actor), auth.current_patient.set(pid)
        try:
            await self.app(scope, receive, send)
        finally:
            auth.current_patient.reset(t2)
            auth.current_actor.reset(t1)


@mcp.tool()
@guarded
def get_care_snapshot() -> dict:
    """Overview of the person in care: today's doses and their status, next appointments,
    open alerts, latest check-in, 7-day adherence and any risk signals. Call this first
    to ground a conversation in real data."""
    return service.snapshot_for(auth.current_actor.get(), _pid())


@mcp.tool()
@guarded
def list_todays_doses() -> dict:
    """List every scheduled medication dose for today with status:
    taken, missed, skipped, due (within 30 min), overdue (>90 min late) or upcoming."""
    return {"doses": service.todays_doses(_pid())}


@mcp.tool()
@guarded
def log_dose(medication: str, status: str = "taken", slot: str | None = None) -> dict:
    """Record that a medication dose was taken, missed or skipped.
    medication: name or partial name (e.g. 'metformin'). status: taken|missed|skipped.
    slot: optional 'HH:MM' dose time; defaults to the nearest unlogged slot today."""
    return service.log_dose(_pid(), medication, status, slot)


@mcp.tool()
@guarded
def record_checkin(mood: int, pain: int = 0, sleep_hours: float | None = None, note: str = "") -> dict:
    """Record a wellbeing check-in. mood: 1 (very low) to 5 (great). pain: 0 to 10.
    sleep_hours: hours slept last night. note: the person's own words, briefly.
    Returns the updated risk signals so you can respond appropriately."""
    return service.record_checkin(_pid(), mood, pain, sleep_hours, note)


@mcp.tool()
@guarded
def record_vital(kind: str, value: float, value2: float | None = None) -> dict:
    """Record a health reading. kind: bp (value=systolic, value2=diastolic), glucose (mg/dL), spo2 (%), weight (kg), hr (bpm), inr.
    Implausible values are rejected: ask the person to repeat the reading. Returns updated risk signals; if oxygen is below 90%,
    sugar below 70, or the pattern is worrying, follow the safety rules."""
    return service.record_vital(_pid(), kind, value, value2)


@mcp.tool()
@guarded
def analyze_wellbeing_trends(days: int = 7) -> dict:
    """Analyze adherence, mood, sleep and pain over recent days and return explainable
    risk signals (mood_decline, sleep_decline, pain_rising, missed_doses, compound_decline)
    with an overall level: ok, watch, high."""
    pid = _pid()
    return {
        "signals": service.evaluate_signals(pid, days),
        "adherence": service.adherence(pid, days),
        "checkins": service.recent_checkins(pid, days),
        "vitals": service.recent_vitals(pid, max(days, 7)),
    }


@mcp.tool()
@guarded
def list_appointments(limit: int = 5) -> dict:
    """Upcoming appointments, soonest first, including whether a ride is needed."""
    return {"appointments": service.upcoming_appointments(_pid(), limit)}


@mcp.tool()
@guarded
def schedule_appointment(title: str, starts_at: str, doctor: str = "", location: str = "",
                         needs_ride: bool = False, notes: str = "") -> dict:
    """Schedule an appointment. starts_at must be ISO-8601 local time, e.g. 2026-10-28T10:30:00."""
    return service.schedule_appointment(_pid(), title, starts_at, doctor, location, needs_ride, notes)


@mcp.tool()
@guarded
def raise_family_alert(severity: str, title: str, detail: str) -> dict:
    """Notify the family/caregivers. severity: info|watch|high|urgent. High and urgent alerts
    reach every caregiver including the physician's clinic; lower levels reach opted-in family only.
    Duplicate open alerts with the same title within 12 hours are merged."""
    return service.raise_alert(_pid(), severity, title, detail)


@mcp.tool()
@guarded
def list_alerts(status: str = "open") -> dict:
    """List family alerts. status: open|resolved|all."""
    return {"alerts": service.list_alerts(_pid(), status)}


@mcp.tool()
@guarded
def resolve_alert(alert_id: int, resolution: str = "") -> dict:
    """Mark a family alert as handled, with a short note on what was done."""
    return service.resolve_alert(_pid(), alert_id, resolution)


@mcp.tool()
@guarded
def remember(content: str, kind: str = "preference") -> dict:
    """Save a durable fact about the person (preferences, routines, family context) so future
    conversations remember it. kind: preference|context|routine."""
    return service.remember(_pid(), content, kind)


@mcp.tool()
@guarded
def recall_memories(limit: int = 20) -> dict:
    """Recall saved facts about the person, newest first. Use at the start of a conversation."""
    return {"memories": service.recall(_pid(), limit)}


@mcp.resource("carecircle://snapshot")
def snapshot_resource() -> str:
    """Live care snapshot as JSON (same permission as get_care_snapshot)."""
    actor = auth.current_actor.get()
    if actor is None or not actor.can("snapshot:read"):
        audit.record(actor, "resource:snapshot", outcome="denied")
        raise PermissionError("Not allowed")
    pid = _pid()
    if not pid or not actor.can_access(pid):
        raise PermissionError("No patient selected")
    audit.record(actor, "resource:snapshot", patient_id=pid)
    return json.dumps(service.snapshot_for(actor, pid), default=str)


@mcp.prompt()
def evening_checkin() -> str:
    """Gentle evening routine: doses, mood, sleep, tomorrow's plan."""
    return (
        "Run the evening check-in: recall memories, list today's doses and gently ask about any not yet taken, "
        "ask how the day felt (mood 1-5), pain, and how they plan to sleep. Log everything. "
        "Mention tomorrow's appointment if any. If trends look worrying, say so kindly and offer to tell the family."
    )
