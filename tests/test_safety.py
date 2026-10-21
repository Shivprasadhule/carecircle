"""Emergency handling: fixed wording, server-side escalation, and no invented reassurance."""
import asyncio
import re

import pytest

from carecircle import agent, auth, db, service


@pytest.mark.parametrize("lang", sorted(agent.SAFETY_MESSAGES))
def test_every_language_has_the_emergency_numbers_and_the_names_and_no_police_number(lang):
    msg = agent.safety_message(lang, "Rohan, Meera")
    assert "112" in msg and "108" in msg and "Rohan, Meera" in msg
    assert not re.search(r"(?<!\d)100(?!\d)", msg)                                                        # 100 is the police
    assert not re.search(r"help is on the way|is coming", msg, re.I)


def test_all_supported_languages_have_a_reviewed_emergency_message():
    assert set(agent.SAFETY_MESSAGES) == set(agent.LANGUAGES)
    assert agent.safety_message("xx-YY", "A") == agent.safety_message("en-IN", "A")                      # unknown code falls back to English
    assert "your family" in agent.safety_message("en-IN", "")


def test_emergency_messages_state_plainly_that_the_assistant_cannot_call_for_help():
    for lang in ("en-IN", "hi-Latn"):
        assert re.search(r"cannot call|nahi bula", agent.safety_message(lang, "x"))


@pytest.mark.parametrize("detail,flagged", [
    ("Asha fell. She has called 112.", True), ("An ambulance is on its way.", True), ("Help is coming.", True), ("They have already called an ambulance.", True),
    ("Asha has called her daughter and is calm.", False), ("Please call 112 now.", False), ("Asha has fallen in the bathroom.", False),
])
def test_unverified_claims_that_help_was_called_are_flagged_in_alert_details(detail, flagged):
    r = service.raise_alert("asha", "high", f"Check {abs(hash(detail))}", detail)
    assert ("NOT confirmed" in r["alert"]["detail"]) is flagged
    db.reset("decline", "deshmukh")


# ------------------------------------------------------------------ streaming override
class FakeStreamAgent:
    def __init__(self, events):
        self.events, self.messages = events, []

    async def stream_async(self, message):
        for e in self.events:
            yield e


def _alert_events(severity):
    result = {"ok": True, "alert": {"id": 1, "severity": severity, "title": "Fall", "detail": "d", "notified": "Rohan Deshmukh, Dr. Sen"}}
    import json
    return [
        {"data": "Oh no. "},
        {"current_tool_use": {"toolUseId": "t1", "name": "raise_family_alert"}},
        {"message": {"role": "assistant", "content": [{"toolUse": {"toolUseId": "t1", "name": "raise_family_alert", "input": {}}}]}},
        {"message": {"role": "user", "content": [{"toolResult": {"toolUseId": "t1", "status": "success", "content": [{"text": json.dumps(result)}]}}]}},
        {"data": "Stay calm, help is on the way."},
    ]


def _run(monkeypatch, actor_id, severity, language="en-IN"):
    monkeypatch.setattr(agent, "_agent", lambda *a, **k: FakeStreamAgent(_alert_events(severity)))
    monkeypatch.setattr(agent, "_ensure_runtime", lambda a, p: [])

    async def go():
        return [e async for e in agent.stream(auth.build_actor(actor_id), "asha", "I fell", "s", language)]
    return asyncio.run(go())


def test_after_an_urgent_alert_the_server_speaks_and_the_model_is_muted(monkeypatch):
    ev = _run(monkeypatch, "asha", "urgent")
    text = "".join(e["delta"] for e in ev if e["type"] == "text")
    assert "Please call 112 now" in text and "Rohan Deshmukh, Dr. Sen" in text and "help is on the way" not in text
    assert ev[-1]["type"] == "done" and "help is on the way" not in ev[-1]["reply"] and "112" in ev[-1]["reply"]
    assert any(e["type"] == "tool_result" and e["tool"] == "raise_family_alert" for e in ev)             # the UI still gets its alert card


def test_the_override_is_spoken_in_the_patients_language(monkeypatch):
    text = "".join(e["delta"] for e in _run(monkeypatch, "asha", "urgent", "hi-IN") if e["type"] == "text")
    assert "कृपया अभी 112" in text


def test_non_urgent_alerts_leave_the_models_reply_alone(monkeypatch):
    text = "".join(e["delta"] for e in _run(monkeypatch, "asha", "high") if e["type"] == "text")
    assert "Stay calm, help is on the way." in text and "Please call 112 now" not in text


def test_family_conversations_are_never_overridden(monkeypatch):
    text = "".join(e["delta"] for e in _run(monkeypatch, "rohan", "urgent") if e["type"] == "text")
    assert "Please call 112 now" not in text                          # Rohan is a caregiver; the script is for the patient himself/herself
