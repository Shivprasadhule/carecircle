"""The product must not reveal how it is built: no model, cloud provider, region, account ids or exception text in responses."""
import asyncio
import json
import re

import pytest
from conftest import bearer

from carecircle import agent, auth, prescription, service, tts

BANNED = re.compile(r"polly|claude|anthropic|bedrock|haiku|sonnet|strands|\bllm\b|ap-southeast|us-east|arn:aws|\b\d{12}\b|AccessDenied|ValidationException|Traceback|AKIA", re.I)
SECRET_ERROR = "AccessDeniedException: User: arn:aws:iam::332053469149:user/BedrockAPIKey-x is not authorized (Traceback ap-southeast-2)"


def test_the_public_health_endpoint_reveals_nothing_about_the_stack(anon):
    body = anon.get("/api/health").json()
    assert set(body) == {"ok", "demo_auth"} and not BANNED.search(json.dumps(body))


def test_system_details_are_for_family_admins_only(as_user, anon):
    assert anon.get("/api/system").status_code == 401
    for user in ("asha", "meera", "drsen"):
        assert as_user(user).get("/api/system").status_code == 403, user
    r = as_user("rohan").get("/api/system")
    assert r.status_code == 200 and {"assistant_model", "region", "mcp_protocol", "assistant_ready"} <= set(r.json())


def test_public_endpoints_contain_no_implementation_details(anon):
    for path in ("/api/health", "/api/languages", "/api/voices", "/api/auth/demo-accounts"):
        assert not BANNED.search(anon.get(path).text), path


def test_a_failing_assistant_gives_a_neutral_message_with_no_exception_text(client, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError(SECRET_ERROR)
    monkeypatch.setattr(agent, "chat", boom)
    for path in ("/api/chat?patient_id=asha", "/api/care-watch?patient_id=asha", "/api/digest?patient_id=asha"):
        r = client.post(path, json={"message": "hi"})
        assert r.status_code == 502 and r.json() == {"error": "The assistant is unavailable right now. Please try again in a moment."}, path
        assert not BANNED.search(r.text)


def test_a_failing_stream_sends_a_neutral_error_event(client, monkeypatch):
    class Broken:
        messages = []

        async def stream_async(self, message):
            raise RuntimeError(SECRET_ERROR)
            yield  # pragma: no cover

    monkeypatch.setattr(agent, "_agent", lambda *a, **k: Broken())
    monkeypatch.setattr(agent, "_ensure_runtime", lambda a, p: [])
    r = client.post("/api/chat/stream?patient_id=asha", json={"message": "hi"})
    events = [json.loads(l[6:]) for l in r.text.splitlines() if l.startswith("data: ")]
    assert events[-1] == {"type": "error", "message": "The assistant is unavailable right now. Please try again in a moment."}
    assert not BANNED.search(r.text)


def test_prescription_failures_never_expose_provider_errors(as_user, monkeypatch):
    class Boom:
        def converse(self, **kw):
            raise RuntimeError(SECRET_ERROR)
    prescription.set_client(Boom())
    r = as_user("rohan").post("/api/admin/patients/asha/prescription/scan", json={"data": __import__("base64").b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 50).decode()})
    prescription.set_client(None)
    assert r.status_code == 502 and r.json()["detail"] == "Could not read the document right now. Please try again." and not BANNED.search(r.text)


def test_a_voice_failure_is_neutral(client, monkeypatch):
    def boom(text, lang):
        raise RuntimeError(SECRET_ERROR)
    monkeypatch.setattr(tts, "synthesize", boom)
    r = client.post("/api/tts", json={"text": "hi", "language": "en-IN"})
    assert r.status_code == 503 and r.json() == {"detail": "Voice is unavailable right now."} and not BANNED.search(r.text)
    monkeypatch.undo()
    monkeypatch.delenv("CARECIRCLE_POLLY_ACCESS_KEY_ID", raising=False)                  # not configured: must not name the provider or env vars
    r = client.post("/api/tts", json={"text": "hi", "language": "en-IN"})
    assert "polly" not in r.text.lower() and "CARECIRCLE" not in r.text


def test_the_assistant_never_describes_itself_in_a_tool_result_or_alert(client):
    """Alerts and snapshots are shown to families: they must read as CareCircle's own output."""
    a = service.raise_alert("asha", "high", "Mood and sleep decline", "Mood fell from 4 to 1.")["alert"]
    snap = client.get("/api/snapshot?patient_id=asha").json()
    assert not BANNED.search(json.dumps(snap)) and not BANNED.search(json.dumps(a))
