"""API contract, MCP protocol conformance, the SSE stream, and optional Polly voice endpoints."""
import asyncio
import json

import pytest
from conftest import bearer
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

from carecircle import agent, service, tts


def test_health_languages_and_voices_are_public(anon):
    assert anon.get("/api/health").json()["ok"] is True
    assert {l["code"] for l in anon.get("/api/languages").json()} == {"en-IN", "hi-IN", "hi-Latn", "ta-IN", "te-IN", "bn-IN", "kn-IN"}
    assert set(anon.get("/api/voices").json()) >= {"server_languages", "preferred", "engines", "engine"}


def test_snapshot_contract_matches_what_the_frontend_expects(client):
    s = client.get("/api/snapshot?patient_id=asha").json()
    for k in ("now", "person", "caregivers", "clinicians", "doses_today", "next_appointments", "open_alerts", "latest_checkin", "checkins_7d",
              "vitals", "adherence", "signals", "memories", "medications"):
        assert k in s, k
    assert s["person"]["name"] == "Asha Deshmukh" and s["signals"]["level"] in {"ok", "watch", "high", "urgent"}


def test_a_patient_id_is_required_when_the_account_has_several_and_implied_when_one(as_user):
    assert as_user("rohan").get("/api/snapshot").status_code == 422                  # Rohan looks after Asha and Madhav
    assert as_user("asha").get("/api/snapshot").json()["person"]["id"] == "asha"      # Asha has exactly one
    assert as_user("vikram").get("/api/snapshot").json()["person"]["id"] == "kamla"


def test_dose_vitals_and_appointment_endpoints_validate(client):
    assert client.post("/api/dose?patient_id=asha", json={"medication": "amlodipine", "slot": "08:00"}).status_code == 200
    assert client.post("/api/dose?patient_id=asha", json={"medication": "nope"}).status_code == 400
    assert client.post("/api/vitals?patient_id=asha", json={"kind": "spo2", "value": 95}).status_code == 200
    assert client.post("/api/vitals?patient_id=asha", json={"kind": "spo2", "value": 5}).status_code == 400
    assert client.post("/api/vitals?patient_id=asha", json={"kind": "bp", "value": 130}).status_code == 400
    assert client.post("/api/appointments?patient_id=asha", json={"title": "X", "starts_at": "next week"}).status_code == 422
    ok = client.post("/api/appointments?patient_id=asha", json={"title": "Dental", "starts_at": "2099-01-01T09:00:00", "needs_ride": True})
    assert ok.status_code == 200 and ok.json()["when"].startswith("Thursday")


def test_alert_resolve_flow_across_the_snapshot(client):
    a = service.raise_alert("asha", "high", "t", "d")["alert"]
    assert len(client.get("/api/snapshot?patient_id=asha").json()["open_alerts"]) == 1
    assert client.post(f"/api/alerts/{a['id']}/resolve").status_code == 200
    assert client.get("/api/snapshot?patient_id=asha").json()["open_alerts"] == []
    assert client.post("/api/alerts/99999/resolve").status_code == 404


def test_scenarios_reset_one_family_and_reject_unknown(client):
    assert client.post("/api/demo/reset", json={"name": "stable"}).json()["scenario"] == "stable"
    assert client.get("/api/snapshot?patient_id=asha").json()["signals"]["level"] in {"ok", "watch"}
    assert client.post("/api/demo/reset", json={"name": "chaos"}).status_code == 400


def test_chat_stream_is_valid_sse_and_carries_language_and_patient(client, monkeypatch):
    seen = {}

    async def fake(actor, pid, message, session_id=None, language="en-IN"):
        seen.update(language=language, pid=pid, actor=actor.id)
        yield {"type": "session", "session_id": session_id}
        yield {"type": "tool_start", "id": "t1", "tool": "log_dose"}
        yield {"type": "text", "delta": "Done."}
        yield {"type": "done", "reply": "Done."}
    monkeypatch.setattr(agent, "stream", fake)
    r = client.post("/api/chat/stream?patient_id=madhav", json={"message": "hi", "language": "ta-IN"})
    assert r.headers["content-type"].startswith("text/event-stream")
    events = [json.loads(line[6:]) for line in r.text.splitlines() if line.startswith("data: ")]
    assert [e["type"] for e in events] == ["session", "tool_start", "text", "done"]
    assert seen == {"language": "ta-IN", "pid": "madhav", "actor": "rohan"}


# ------------------------------------------------------------------ MCP protocol conformance
def _session(server, user, patient, fn):
    async def go():
        async with streamablehttp_client(f"{server}/mcp/", headers=bearer(user) | {"X-Patient-Id": patient}) as (r, w, _):
            async with ClientSession(r, w) as s:
                init = await s.initialize()
                return await fn(s, init)
    return asyncio.run(go())


def test_mcp_negotiates_2025_11_25_and_lists_the_tools(server):
    async def fn(s, init):
        return init.protocolVersion, {t.name for t in (await s.list_tools()).tools}, {p.name for p in (await s.list_prompts()).prompts}
    version, tools, prompts = _session(server, "rohan", "asha", fn)
    assert version >= "2025-11-25" and "evening_checkin" in prompts
    assert {"log_dose", "record_checkin", "record_vital", "raise_family_alert", "analyze_wellbeing_trends", "remember", "recall_memories"} <= tools


def test_mcp_tool_call_changes_state_and_tool_errors_are_graceful(server):
    async def fn(s, init):
        return await s.call_tool("log_dose", {"medication": "amlodipine"}), await s.call_tool("log_dose", {"medication": "zzz"})
    ok, bad = _session(server, "rohan", "asha", fn)
    assert not ok.isError and '"status": "taken"' in ok.content[0].text
    assert not bad.isError and '"ok": false' in bad.content[0].text                      # a tool-level failure, not a protocol error
    assert next(d for d in service.todays_doses("asha") if d["medication"] == "Amlodipine")["status"] == "taken"


def test_mcp_vitals_tool_flags_a_dangerous_reading_for_the_copd_patient(server):
    async def fn(s, init):
        return json.loads((await s.call_tool("record_vital", {"kind": "spo2", "value": 86})).content[0].text)
    res = _session(server, "imran", "abdul", fn)
    assert res["ok"] and {s["signal"]: s["severity"] for s in res["signals"]["signals"]}["low_oxygen"] == "urgent"


# ------------------------------------------------------------------ optional AWS voice
def test_voices_endpoint_is_empty_without_polly_and_lists_languages_with_it(anon, monkeypatch):
    monkeypatch.delenv("CARECIRCLE_POLLY_ACCESS_KEY_ID", raising=False)
    assert anon.get("/api/voices").json()["server_languages"] == []
    monkeypatch.setenv("CARECIRCLE_POLLY_ACCESS_KEY_ID", "AKIATEST")
    monkeypatch.setenv("CARECIRCLE_POLLY_SECRET_ACCESS_KEY", "secret")
    v = anon.get("/api/voices").json()
    assert set(v["server_languages"]) == {"en-IN", "hi-IN", "hi-Latn"} and v["engines"]["hi-IN"] == "server" and "polly" not in json.dumps(v).lower()


def test_tts_requires_sign_in_returns_audio_and_reports_missing_config(anon, client, monkeypatch):
    assert anon.post("/api/tts", json={"text": "hi", "language": "en-IN"}).status_code == 401
    monkeypatch.setattr(tts, "synthesize", lambda text, lang: (b"ID3audio", "audio/mpeg"))
    r = client.post("/api/tts", json={"text": "नमस्कार", "language": "hi-IN"})
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg" and r.content == b"ID3audio"
    monkeypatch.undo()
    monkeypatch.delenv("CARECIRCLE_POLLY_ACCESS_KEY_ID", raising=False)
    assert client.post("/api/tts", json={"text": "hello", "language": "xx-YY"}).status_code == 400
    r = client.post("/api/tts", json={"text": "hello", "language": "en-IN"})
    assert r.status_code == 503 and r.json()["detail"] == "Voice is unavailable right now."
