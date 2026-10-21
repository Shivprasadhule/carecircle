"""One family must never see, change or learn about another family's patients, people, alerts, chats or audit trail."""
import asyncio
import json

import pytest
from conftest import bearer
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

from carecircle import audit, db, service


def _mcp(server, user, patient, tool, args=None):
    async def go():
        h = bearer(user)
        if patient:
            h["X-Patient-Id"] = patient
        async with streamablehttp_client(f"{server}/mcp/", headers=h) as (r, w, _):
            async with ClientSession(r, w) as s:
                await s.initialize()
                return await s.call_tool(tool, args or {})
    return asyncio.run(go())


# (user, a patient that belongs to a DIFFERENT family)
OUTSIDERS = [("rohan", "lakshmi"), ("rohan", "abdul"), ("suresh", "asha"), ("imran", "sudipta"), ("soumya", "thomas"), ("vikram", "zainab"),
             ("asha", "madhav"), ("lakshmi", "asha"), ("drraman", "asha"), ("drsen", "lakshmi")]


@pytest.mark.parametrize("user,other", OUTSIDERS)
def test_reading_another_familys_patient_looks_like_it_does_not_exist(as_user, user, other):
    c = as_user(user)
    for path in ("/api/snapshot", "/api/conversations"):
        r = c.get(f"{path}?patient_id={other}")
        if path == "/api/snapshot":
            assert r.status_code == 404 and r.json() == {"detail": "Not found"}               # identical to a made-up id
    assert c.get("/api/snapshot?patient_id=does-not-exist").json() == {"detail": "Not found"}


@pytest.mark.parametrize("user,other", [("rohan", "lakshmi"), ("suresh", "asha"), ("drsen", "kamla"), ("asha", "madhav")])
def test_writing_to_another_familys_patient_is_refused_and_changes_nothing(as_user, user, other):
    c = as_user(user)
    before = service.todays_doses(other)
    assert c.post(f"/api/dose?patient_id={other}", json={"medication": "amlodipine"}).status_code in (403, 404)
    assert c.post(f"/api/vitals?patient_id={other}", json={"kind": "weight", "value": 70}).status_code in (403, 404)
    assert c.post(f"/api/appointments?patient_id={other}", json={"title": "x", "starts_at": "2099-01-01T09:00:00"}).status_code in (403, 404)
    assert c.post(f"/api/chat/stream?patient_id={other}", json={"message": "hi"}).status_code in (403, 404)
    assert c.post(f"/api/care-watch/stream?patient_id={other}").status_code in (403, 404)
    assert service.todays_doses(other) == before


def test_the_patients_list_and_switcher_only_contain_your_own_families_patients(as_user):
    assert {p["id"] for p in as_user("rohan").get("/api/patients").json()} == {"asha", "madhav"}
    assert {p["id"] for p in as_user("imran").get("/api/patients").json()} == {"abdul", "zainab"}
    assert [p["id"] for p in as_user("vikram").get("/api/patients").json()] == ["kamla"]
    assert {p["id"] for p in as_user("drreddy").get("/api/patients").json()} == {"abdul", "zainab"}


def test_alerts_cannot_be_resolved_across_families(as_user):
    a = service.raise_alert("lakshmi", "high", "Iyer only", "d")["alert"]
    assert as_user("rohan").post(f"/api/alerts/{a['id']}/resolve").status_code == 404
    assert len(service.list_alerts("lakshmi")) == 1
    assert as_user("suresh").post(f"/api/alerts/{a['id']}/resolve").status_code == 200
    db.reset("decline", "iyer")


def test_an_alert_is_invisible_to_other_families_through_every_view(as_user):
    service.raise_alert("abdul", "urgent", "Khan emergency", "d")
    for user, pid in (("rohan", "asha"), ("suresh", "lakshmi"), ("soumya", "sudipta")):
        snap = as_user(user).get(f"/api/snapshot?patient_id={pid}").json()
        assert all(a["title"] != "Khan emergency" for a in snap["open_alerts"])
    assert any(a["title"] == "Khan emergency" for a in as_user("imran").get("/api/snapshot?patient_id=abdul").json()["open_alerts"])
    db.reset("decline", "khan")


def test_the_audit_trail_is_per_family(as_user, monkeypatch):
    as_user("rohan").post("/api/dose?patient_id=asha", json={"medication": "amlodipine"})
    as_user("suresh").post("/api/vitals?patient_id=lakshmi", json={"kind": "weight", "value": 58.0})
    rohan_rows, suresh_rows = as_user("rohan").get("/api/audit?limit=500").json(), as_user("suresh").get("/api/audit?limit=500").json()
    assert rohan_rows and suresh_rows
    assert all(r["family_id"] == "deshmukh" for r in rohan_rows) and all(r["family_id"] == "iyer" for r in suresh_rows)
    assert any(r["action"] == "api:log_dose" and r["actor_id"] == "rohan" for r in rohan_rows)
    assert any(r["action"] == "api:record_vital" and r["actor_id"] == "suresh" for r in suresh_rows)
    assert not any(r["actor_id"] == "suresh" or r["patient_id"] == "lakshmi" for r in rohan_rows)        # nothing from the Iyer family
    assert not any(r["actor_id"] == "rohan" or r["patient_id"] == "asha" for r in suresh_rows)           # and nothing of ours in theirs


def test_conversations_are_visible_only_inside_the_family(as_user, monkeypatch):
    from carecircle import agent

    async def fake(actor, pid, message, session_id=None, language="en-IN"):
        yield {"type": "session", "session_id": session_id}
        yield {"type": "text", "delta": "ok"}
        yield {"type": "done", "reply": "ok"}
    monkeypatch.setattr(agent, "stream", fake)
    as_user("asha").post("/api/chat/stream?patient_id=asha", json={"message": "private words", "session_id": "t1"})
    as_user("lakshmi").post("/api/chat/stream?patient_id=lakshmi", json={"message": "iyer words", "session_id": "t1"})
    ids = lambda u: {c["id"] for c in as_user(u).get("/api/conversations").json()}                # noqa: E731
    assert "asha:asha:t1" in ids("rohan") and "lakshmi:lakshmi:t1" not in ids("rohan")
    assert "lakshmi:lakshmi:t1" in ids("suresh") and "asha:asha:t1" not in ids("suresh")
    assert as_user("suresh").get("/api/conversations/asha:asha:t1").status_code == 404
    assert as_user("rohan").get("/api/conversations/lakshmi:lakshmi:t1").status_code == 404


def test_admin_overview_never_leaks_other_families(as_user):
    ov = as_user("rohan").get("/api/admin/overview").json()
    assert ov["family"]["id"] == "deshmukh"
    assert {m["id"] for m in ov["members"]} == {"asha", "madhav", "rohan", "meera", "isha"}
    assert {p["id"] for p in ov["patients"]} == {"asha", "madhav"}
    assert all(f["family_id"] == "deshmukh" for f in ov["facilities"])
    blob = json.dumps(ov)
    for other in ("Lakshmi", "Suresh", "Greams", "Abdul", "Kamla", "Thomas", "Sudipta"):
        assert other not in blob


# ------------------------------------------------------------------ MCP: the connection is bound to one patient
def test_mcp_refuses_a_patient_the_account_cannot_access(server):
    async def go():
        h = bearer("rohan") | {"X-Patient-Id": "lakshmi"}
        async with streamablehttp_client(f"{server}/mcp/", headers=h) as (r, w, _):
            async with ClientSession(r, w) as s:
                await s.initialize()
    with pytest.raises(BaseException):                                    # the 403 aborts the connection
        asyncio.run(go())
    assert any(a["action"] == "mcp:connect" and a["outcome"] == "denied" and a["actor_id"] == "rohan" for a in db.rows("SELECT * FROM audit ORDER BY id DESC LIMIT 5"))


def test_mcp_tools_only_ever_touch_the_bound_patient(server):
    res = json.loads(_mcp(server, "rohan", "madhav", "get_care_snapshot").content[0].text)
    assert res["person"]["id"] == "madhav" and {d["medication"] for d in res["doses_today"]} >= {"Warfarin", "Metoprolol"}
    assert "Metformin" not in {d["medication"] for d in res["doses_today"]}               # Asha's medicine is not here
    log = json.loads(_mcp(server, "rohan", "madhav", "log_dose", {"medication": "metformin"}).content[0].text)
    assert log["ok"] is False                                                               # cannot reach Asha's list through Madhav's connection


def test_mcp_without_a_patient_is_refused_when_the_account_has_several(server):
    r = json.loads(_mcp(server, "rohan", None, "get_care_snapshot").content[0].text)
    assert r["ok"] is False and "No patient is selected" in r["error"]
    only = json.loads(_mcp(server, "asha", None, "get_care_snapshot").content[0].text)    # a patient has exactly one: implied
    assert only["person"]["id"] == "asha"


def test_a_tool_cannot_resolve_another_patients_alert_even_in_the_same_family(server):
    a = service.raise_alert("madhav", "high", "Madhav alert", "d")["alert"]
    json.loads(_mcp(server, "rohan", "asha", "resolve_alert", {"alert_id": a["id"]}).content[0].text)
    assert len(service.list_alerts("madhav")) == 1
