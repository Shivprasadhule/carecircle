"""Regression: the FIRST agent built in a process must use the configured Bedrock model.

Bug history: `Agent(model=_model, tools=_ensure_runtime(actor))` evaluated `model=_model` before `_ensure_runtime` created it, so the
first agent got model=None and Strands silently fell back to its default (us-east-1), which region-locked accounts refuse.
"""
import pytest

from carecircle import agent, auth


class FakeAgent:
    def __init__(self, **kw):
        self.kw = kw
        self.system_prompt = kw["system_prompt"]


@pytest.fixture(autouse=True)
def isolate(monkeypatch):
    monkeypatch.setattr(agent, "Agent", FakeAgent)
    monkeypatch.setattr(agent, "_sessions", {})
    monkeypatch.setattr(agent, "_model", None)


def test_first_agent_gets_the_configured_model_not_none(monkeypatch):
    def fake_runtime(actor, pid):
        agent._model = "THE-CONFIGURED-MODEL"
        return ["tool"]
    monkeypatch.setattr(agent, "_ensure_runtime", fake_runtime)
    a = agent._agent("s1", auth.build_actor("asha"), "asha", "person")
    assert a.kw["model"] == "THE-CONFIGURED-MODEL" and a.kw["tools"] == ["tool"]


def test_sessions_are_keyed_by_user_and_patient(monkeypatch):
    monkeypatch.setattr(agent, "_ensure_runtime", lambda actor, pid: [])
    rohan, asha = auth.build_actor("rohan"), auth.build_actor("asha")
    a = agent._agent("same", asha, "asha", "person")
    b = agent._agent("same", rohan, "asha", "family")                 # another user, same session id
    c = agent._agent("same", rohan, "madhav", "family")               # same user, another patient
    assert len({id(a), id(b), id(c)}) == 3 and len(agent._sessions) == 3


def test_the_prompt_carries_the_patients_profile_instructions_and_language(monkeypatch):
    monkeypatch.setattr(agent, "_ensure_runtime", lambda actor, pid: [])
    a = agent._agent("s", auth.build_actor("thomas"), "thomas", "person", "hi-Latn")
    p = a.system_prompt
    assert "Thomas Nair" in p and "Parkinson" in p and "Levodopa timing is strict" in p and "Hinglish" in p
    assert "Asha" not in p and "Lakshmi" not in p                       # nobody else's data is in the prompt


def test_a_user_cannot_build_an_agent_for_a_patient_they_may_not_access(monkeypatch):
    with pytest.raises(PermissionError):
        agent._ensure_runtime(auth.build_actor("rohan"), "lakshmi")
