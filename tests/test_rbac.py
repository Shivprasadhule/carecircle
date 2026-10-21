"""Role-based permissions inside one family, the audit trail, and chat history."""
import asyncio
import json
from datetime import datetime, timedelta

import pytest
from conftest import bearer
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

from carecircle import agent, audit, auth, db, service


def _tool(server, user, patient, name, args=None):
    async def go():
        async with streamablehttp_client(f"{server}/mcp/", headers=bearer(user) | {"X-Patient-Id": patient}) as (r, w, _):
            async with ClientSession(r, w) as s:
                await s.initialize()
                return await s.call_tool(name, args or {})
    return json.loads(asyncio.run(go()).content[0].text)


def _stub_agent(monkeypatch, reply="Fine."):
    async def fake(actor, pid, message, session_id=None, language="en-IN"):
        yield {"type": "session", "session_id": session_id}
        yield {"type": "tool_result", "id": "t", "tool": "log_dose", "input": {}, "status": "success", "result": {}}
        yield {"type": "text", "delta": reply}
        yield {"type": "done", "reply": reply}
    monkeypatch.setattr(agent, "stream", fake)


P = "?patient_id=asha"
DOSE = {"medication": "amlodipine", "slot": "08:00"}


@pytest.mark.parametrize("user,method,path,body,expected", [
    # the person in care
    ("asha", "GET", f"/api/snapshot{P}", None, 200),
    ("asha", "POST", f"/api/dose{P}", DOSE, 200),
    ("asha", "POST", f"/api/vitals{P}", {"kind": "weight", "value": 61}, 200),
    ("asha", "POST", f"/api/alerts/1/resolve", None, 403),
    ("asha", "POST", f"/api/care-watch/stream{P}", None, 403),
    ("asha", "GET", "/api/audit", None, 403),
    ("asha", "GET", "/api/admin/overview", None, 403),
    ("asha", "POST", "/api/admin/members", {"name": "X", "username": "xx1", "password": "Passw0rd!x"}, 403),
    ("asha", "PATCH", "/api/admin/patients/asha", {"instructions": "Eat sweets"}, 403),
    ("asha", "POST", "/api/demo/reset", {"name": "stable"}, 403),
    # family member
    ("meera", "GET", f"/api/snapshot{P}", None, 200),
    ("meera", "POST", f"/api/dose{P}", DOSE, 200),
    ("meera", "POST", f"/api/appointments{P}", {"title": "Dentist", "starts_at": "2099-01-01T09:00:00"}, 200),
    ("meera", "POST", f"/api/care-watch/stream{P}", None, 200),
    ("meera", "GET", "/api/audit", None, 403),                                            # admins only
    ("meera", "GET", "/api/admin/overview", None, 403),
    ("meera", "POST", "/api/admin/patients/asha/medications", {"name": "X", "dose": "1 mg", "times": "08:00"}, 403),
    ("meera", "PATCH", "/api/admin/patients/asha", {"instructions": "x"}, 403),
    ("meera", "DELETE", "/api/admin/members/isha", None, 403),
    ("meera", "POST", "/api/demo/reset", {"name": "stable"}, 403),
    # family admin
    ("rohan", "GET", f"/api/snapshot{P}", None, 200),
    ("rohan", "GET", "/api/audit", None, 200),
    ("rohan", "GET", "/api/admin/overview", None, 200),
    ("rohan", "POST", "/api/demo/reset", {"name": "decline"}, 200),
    ("rohan", "DELETE", "/api/conversations", None, 403),                                 # only the patient erases her own chats
    # clinician: read-only
    ("drsen", "GET", f"/api/snapshot{P}", None, 200),
    ("drsen", "POST", f"/api/dose{P}", DOSE, 403),
    ("drsen", "POST", f"/api/vitals{P}", {"kind": "weight", "value": 61}, 403),
    ("drsen", "POST", f"/api/appointments{P}", {"title": "x", "starts_at": "2099-01-01T09:00:00"}, 403),
    ("drsen", "POST", f"/api/care-watch/stream{P}", None, 403),
    ("drsen", "GET", "/api/audit", None, 403),
    ("drsen", "GET", "/api/admin/overview", None, 403),
    ("drsen", "PATCH", "/api/admin/patients/asha", {"instructions": "x"}, 403),
    ("drsen", "DELETE", "/api/conversations", None, 403),
    ("drsen", "POST", f"/api/chat/stream{P}", {"message": "How is she?"}, 200),            # may ask questions
])
def test_rest_permission_matrix(as_user, monkeypatch, user, method, path, body, expected):
    _stub_agent(monkeypatch)
    c = as_user(user)
    r = c.request(method, path, json=body) if body is not None else c.request(method, path)
    assert r.status_code == expected, (user, path, r.text)
    db.reset("decline", "deshmukh")


def test_the_clinician_is_read_only_across_every_mutation_route(as_user):
    c = as_user("drsen")
    for method, path in [("POST", "/api/admin/patients"), ("PATCH", "/api/admin/members/rohan"), ("DELETE", "/api/admin/medications/1"),
                         ("POST", "/api/admin/facilities"), ("DELETE", "/api/admin/appointments/1"), ("PATCH", "/api/admin/facilities/1")]:
        assert c.request(method, path, json={}).status_code == 403, path


def test_denied_attempts_are_audited_with_who_and_what(as_user):
    as_user("drsen").post("/api/dose?patient_id=asha", json=DOSE)
    rows = as_user("rohan").get("/api/audit?limit=20").json()
    denied = db.rows("SELECT * FROM audit WHERE actor_id='drsen' AND outcome='denied' ORDER BY id DESC LIMIT 1")
    assert denied and denied[0]["target"] == "dose:log" and denied[0]["actor_role"] == "clinician"
    # a family sees clinician activity about ITS OWN patients and nothing about anyone else's
    assert all(r["family_id"] == "deshmukh" and (r["actor_id"] != "drsen" or r["patient_id"] in ("asha", "madhav")) for r in rows)


# ------------------------------------------------------------------ MCP tool RBAC (server-side, whatever the model decides)
def test_mcp_connection_without_a_token_is_refused(anon):
    assert anon.post("/mcp/", json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}).status_code == 401


def test_clinician_cannot_change_the_record_through_mcp(server, client):
    before = {(d["medication"], d["slot"]): d["status"] for d in service.todays_doses("asha")}
    res = _tool(server, "drsen", "asha", "log_dose", {"medication": "amlodipine"})
    assert res["ok"] is False and "Not allowed" in res["error"]
    assert before == {(d["medication"], d["slot"]): d["status"] for d in service.todays_doses("asha")}
    assert any(r["action"] == "tool:log_dose" and r["outcome"] == "denied" and r["actor_id"] == "drsen" for r in db.rows("SELECT * FROM audit ORDER BY id DESC LIMIT 5"))


def test_patient_can_log_and_record_vitals_but_not_see_alerts_or_resolve_them(server):
    assert _tool(server, "asha", "asha", "log_dose", {"medication": "amlodipine"})["ok"] is True
    assert _tool(server, "asha", "asha", "record_vital", {"kind": "glucose", "value": 140})["ok"] is True
    assert _tool(server, "asha", "asha", "list_alerts")["ok"] is False
    assert _tool(server, "asha", "asha", "resolve_alert", {"alert_id": 1})["ok"] is False


def test_family_uses_every_tool_and_clinician_only_reads(server):
    assert _tool(server, "rohan", "asha", "resolve_alert", {"alert_id": 999})["ok"] is True
    for tool, args in [("raise_family_alert", {"severity": "watch", "title": "t", "detail": "d"}), ("remember", {"content": "x"}), ("record_checkin", {"mood": 3}),
                       ("record_vital", {"kind": "hr", "value": 70}), ("log_dose", {"medication": "amlodipine"})]:
        assert _tool(server, "drsen", "asha", tool, args)["ok"] is False, tool
    assert _tool(server, "drsen", "asha", "get_care_snapshot")["person"]["id"] == "asha"
    assert "signals" in _tool(server, "drsen", "asha", "analyze_wellbeing_trends")


def test_every_mcp_tool_has_a_permission_so_new_tools_cannot_ship_unguarded():
    from carecircle.mcp_server import mcp
    assert {t.name for t in asyncio.run(mcp.list_tools())} == set(auth.TOOL_PERMS)
    assert all(p in set().union(*auth.PERMS.values()) for p in auth.TOOL_PERMS.values())


def test_the_admin_role_is_a_strict_superset_of_family_and_family_of_clinician_reads():
    assert auth.PERMS["family"] <= auth.PERMS["admin"]
    assert {"snapshot:read", "alert:read", "memory:read"} <= auth.PERMS["clinician"] <= auth.PERMS["family"] | {"chat:family"}
    assert not {"dose:log", "alert:resolve", "audit:read", "members:manage"} & auth.PERMS["clinician"]
    assert not {"alert:read", "audit:read", "agent:run"} & auth.PERMS["person"]


def test_patient_never_receives_family_alerts_through_any_door(server, client, as_user):
    service.raise_alert("asha", "high", "Family only", "detail the patient should not see")
    assert [a["title"] for a in client.get("/api/snapshot?patient_id=asha").json()["open_alerts"]] == ["Family only"]
    assert [a["title"] for a in as_user("drsen").get("/api/snapshot?patient_id=asha").json()["open_alerts"]] == ["Family only"]
    assert as_user("asha").get("/api/snapshot?patient_id=asha").json()["open_alerts"] == []
    assert _tool(server, "asha", "asha", "get_care_snapshot")["open_alerts"] == []
    assert _tool(server, "rohan", "asha", "get_care_snapshot")["open_alerts"]


# ------------------------------------------------------------------ audit trail contents
def test_audit_never_copies_free_text_or_secrets(server, client):
    _tool(server, "asha", "asha", "record_checkin", {"mood": 2, "pain": 6, "note": "my chest feels tight and I am scared"})
    row = next(r for r in client.get("/api/audit?limit=10").json() if r["action"] == "tool:record_checkin")
    assert "chest" not in row["detail"] and "scared" not in row["detail"] and "<redacted>" in row["detail"]
    assert row["actor_id"] == "asha" and row["outcome"] == "allowed" and row["patient_id"] == "asha"


def test_audit_limit_is_capped_and_newest_first(client):
    audit.record(auth.build_actor("rohan"), "test:marker", "a")
    audit.record(auth.build_actor("rohan"), "test:marker", "b")
    rows = client.get("/api/audit?limit=999999").json()
    assert len(rows) <= 500 and rows[0]["target"] == "b" and rows[1]["target"] == "a"


def test_demo_reset_keeps_users_passwords_audit_and_chat_history(client, monkeypatch):
    _stub_agent(monkeypatch)
    client.post("/api/chat/stream?patient_id=asha", json={"message": "hello", "session_id": "keepme"})
    n = len(client.get("/api/audit?limit=500").json())
    users_before = db.rows("SELECT id, password_hash FROM users ORDER BY id")
    assert client.post("/api/demo/reset", json={"name": "stable"}).status_code == 200
    assert len(client.get("/api/audit?limit=500").json()) >= n
    assert any(c["id"] == "rohan:asha:keepme" for c in client.get("/api/conversations").json())
    assert db.rows("SELECT id, password_hash FROM users ORDER BY id") == users_before


def test_demo_reset_only_touches_the_callers_family(client):
    service.raise_alert("lakshmi", "watch", "Iyer alert", "d")
    n_before = len(service.recent_checkins("lakshmi", 8))
    assert client.post("/api/demo/reset", json={"name": "fresh"}).status_code == 200
    assert service.recent_checkins("asha", 8) == []                                   # Deshmukh reset to 'fresh'
    assert len(service.recent_checkins("lakshmi", 8)) == n_before and service.list_alerts("lakshmi")        # Iyer untouched
    db.reset("decline", "iyer")


def test_audit_chat_and_alert_timestamps_use_real_time_not_the_pinned_demo_clock(client, monkeypatch):
    _stub_agent(monkeypatch)
    client.post("/api/chat/stream?patient_id=asha", json={"message": "hello", "session_id": "clock"})
    service.raise_alert("asha", "watch", "Clock check", "d")
    now = datetime.now()
    for ts in (client.get("/api/audit?limit=1").json()[0]["ts"], client.get("/api/conversations").json()[0]["updated_at"],
               next(a for a in service.list_alerts("asha") if a["title"] == "Clock check")["ts"]):
        assert abs((now - datetime.fromisoformat(ts)).total_seconds()) < 30, ts
    assert db.now().hour == 12                                                         # while the care schedule follows the pinned clock


# ------------------------------------------------------------------ chat history
def test_conversations_are_stored_per_user_and_patient_and_visible_by_role(as_user, monkeypatch):
    _stub_agent(monkeypatch, "Take it with food.")
    as_user("asha").post("/api/chat/stream?patient_id=asha", json={"message": "I took my metformin", "session_id": "s1"})
    as_user("rohan").post("/api/chat/stream?patient_id=asha", json={"message": "How is she?", "session_id": "s1"})
    as_user("rohan").post("/api/chat/stream?patient_id=madhav", json={"message": "How is he?", "session_id": "s1"})
    assert [c["id"] for c in as_user("asha").get("/api/conversations").json()] == ["asha:asha:s1"]
    fam = {c["id"] for c in as_user("meera").get("/api/conversations").json()}
    assert {"asha:asha:s1", "rohan:asha:s1", "rohan:madhav:s1"} <= fam                  # same session id, different user/patient: separate threads
    assert {c["id"] for c in as_user("rohan").get("/api/conversations?patient_id=madhav").json()} == {"rohan:madhav:s1"}
    assert as_user("drsen").get("/api/conversations").json() == []
    msgs = as_user("rohan").get("/api/conversations/asha:asha:s1").json()
    assert [m["who"] for m in msgs] == ["user", "assistant"] and msgs[0]["text"] == "I took my metformin" and json.loads(msgs[1]["tools"]) == ["log_dose"]
    assert as_user("asha").get("/api/conversations/rohan:asha:s1").status_code == 404
    assert as_user("drsen").get("/api/conversations/asha:asha:s1").status_code == 404


def test_patient_can_delete_her_own_history_and_it_is_audited(as_user, monkeypatch):
    _stub_agent(monkeypatch)
    as_user("asha").post("/api/chat/stream?patient_id=asha", json={"message": "private thought", "session_id": "d1"})
    as_user("rohan").post("/api/chat/stream?patient_id=asha", json={"message": "family chat", "session_id": "d1"})
    assert as_user("asha").delete("/api/conversations").json()["deleted"] >= 1
    ids = {c["id"] for c in as_user("rohan").get("/api/conversations").json()}
    assert "asha:asha:d1" not in ids and "rohan:asha:d1" in ids
    assert any(r["action"] == "conversation:delete_own" and r["actor_id"] == "asha" for r in as_user("rohan").get("/api/audit?limit=20").json())


def test_retention_purges_old_messages_only(client, monkeypatch):
    _stub_agent(monkeypatch)
    client.post("/api/chat/stream?patient_id=asha", json={"message": "recent", "session_id": "r1"})
    old = (db.real_now() - timedelta(days=45)).isoformat()
    with db.conn() as c:
        c.execute("INSERT INTO conversations (id,user_id,patient_id,role,language,started_at,updated_at) VALUES ('rohan:asha:old','rohan','asha','family','en-IN',?,?)", (old, old))
        c.execute("INSERT INTO messages (conv_id,ts,who,text,tools) VALUES ('rohan:asha:old',?,'user','ancient','[]')", (old,))
    assert audit.purge(days=30) >= 1
    ids = {c["id"] for c in client.get("/api/conversations").json()}
    assert "rohan:asha:old" not in ids and "rohan:asha:r1" in ids


def test_chat_persona_comes_from_the_account_not_the_request():
    assert agent.role_for(auth.build_actor("asha")) == "person"
    assert all(agent.role_for(auth.build_actor(u)) == "family" for u in ("rohan", "meera", "drsen"))
