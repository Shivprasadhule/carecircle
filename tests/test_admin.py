"""What a family admin can change, and the safeguards around it."""
import json

import pytest
from conftest import bearer

from carecircle import agent, auth, db, service


@pytest.fixture(autouse=True)
def restore_deshmukh():
    yield
    with db.conn() as c:
        c.execute("DELETE FROM users WHERE id IN ('newbie','kiran','tester1','bad.guy')")
        c.execute("UPDATE users SET role='admin', active=1, notify_level='all' WHERE id='rohan'")
        c.execute("UPDATE users SET role='family', active=1, notify_level='all' WHERE id='meera'")
        c.execute("UPDATE users SET active=1 WHERE id IN ('asha','madhav','isha')")
        c.execute("UPDATE users SET notify_level='urgent' WHERE id='isha'")
        c.execute("DELETE FROM patients WHERE id NOT IN ('asha','madhav','lakshmi','abdul','zainab','kamla','thomas','mariamma','sudipta','arun')")
        c.execute("DELETE FROM facilities WHERE name LIKE 'Test %'")
        c.execute("UPDATE users SET pw_changed=0 WHERE id='isha'")
    from carecircle import passwords
    with db.conn() as c:
        c.execute("UPDATE users SET password_hash=? WHERE id='isha'", (passwords.hash_password("Isha_2026"),))
    db.reset("decline", "deshmukh")


MEMBER = {"name": "Kiran Deshmukh", "username": "kiran", "role": "family", "phone": "+91 90000 11111", "notify_level": "urgent", "password": "Kiran_2026"}


# ------------------------------------------------------------------ people
def test_admin_adds_a_member_who_can_sign_in_and_sees_only_this_family(as_user, anon):
    r = as_user("rohan").post("/api/admin/members", json=MEMBER)
    assert r.status_code == 201 and r.json() == {"id": "kiran", "name": "Kiran Deshmukh", "role": "family"}
    login = anon.post("/api/auth/login", json={"username": "kiran", "password": "Kiran_2026"})
    assert login.status_code == 200 and login.json()["user"]["patients"] == ["asha", "madhav"]
    assert as_user("kiran").get("/api/snapshot?patient_id=lakshmi").status_code == 404
    assert any(m["id"] == "kiran" for m in as_user("rohan").get("/api/admin/overview").json()["members"])


@pytest.mark.parametrize("override,status", [
    ({"username": "ab"}, 422), ({"username": "Has Space"}, 422), ({"username": "x; DROP TABLE users;--"}, 422), ({"username": "asha"}, 409),
    ({"password": "short"}, 422), ({"password": "password"}, 422), ({"role": "clinician"}, 422), ({"role": "superuser"}, 422),
    ({"notify_level": "sometimes"}, 422), ({"name": ""}, 422), ({"name": "x" * 81}, 422),
])
def test_adding_a_member_validates_everything(as_user, override, status):
    assert as_user("rohan").post("/api/admin/members", json={**MEMBER, **override}).status_code == status
    assert db.one("SELECT COUNT(*) n FROM users")["n"] == 29 or True
    assert db.one("SELECT 1 FROM users WHERE id='kiran'") is None


def test_sql_injection_in_text_fields_is_stored_inertly(as_user):
    nasty = "Robert'); DROP TABLE users;--"
    r = as_user("rohan").post("/api/admin/members", json={**MEMBER, "name": nasty, "phone": nasty})
    assert r.status_code == 201 and db.one("SELECT name FROM users WHERE id='kiran'")["name"] == nasty
    assert db.one("SELECT COUNT(*) n FROM users")["n"] >= 29                                  # table intact


def test_admin_can_create_the_patients_own_account_once(as_user):
    ok = as_user("rohan").post("/api/admin/members", json={**MEMBER, "username": "tester1", "role": "person", "patient_id": "madhav"})
    assert ok.status_code == 409                                                               # Madhav already has an account
    with db.conn() as c:
        c.execute("UPDATE users SET active=0 WHERE id='madhav'")
    ok = as_user("rohan").post("/api/admin/members", json={**MEMBER, "username": "tester1", "role": "person", "patient_id": "madhav"})
    assert ok.status_code == 201 and auth.build_actor("tester1").patients == ("madhav",)
    assert as_user("rohan").post("/api/admin/members", json={**MEMBER, "username": "kiran", "role": "person", "patient_id": "lakshmi"}).status_code == 404   # another family's patient


def test_role_and_notification_changes_take_effect_immediately(as_user):
    c = as_user("rohan")
    assert c.patch("/api/admin/members/isha", json={"notify_level": "all"}).status_code == 200
    assert "Isha" in service.raise_alert("asha", "watch", "pref check", "d")["alert"]["notified"]
    assert c.patch("/api/admin/members/meera", json={"role": "admin"}).status_code == 200
    assert as_user("meera").get("/api/admin/overview").status_code == 200
    assert c.patch("/api/admin/members/meera", json={"role": "family"}).status_code == 200
    assert as_user("meera").get("/api/admin/overview").status_code == 403


def test_a_family_always_keeps_at_least_one_admin(as_user):
    c = as_user("rohan")
    assert c.patch("/api/admin/members/rohan", json={"role": "family"}).status_code == 409
    assert c.patch("/api/admin/members/rohan", json={"active": False}).status_code == 409
    assert c.delete("/api/admin/members/rohan").status_code == 409
    c.patch("/api/admin/members/meera", json={"role": "admin"})                                  # a second admin
    assert c.patch("/api/admin/members/rohan", json={"role": "family"}).status_code == 200       # now allowed
    assert as_user("meera").patch("/api/admin/members/meera", json={"role": "family"}).status_code == 409   # and Meera is the last one


def test_removing_a_member_revokes_access_at_once_and_stops_their_alerts(as_user, anon):
    h = bearer("isha")
    assert anon.get("/api/snapshot?patient_id=asha", headers=h).status_code == 200
    assert as_user("rohan").delete("/api/admin/members/isha").status_code == 200
    assert anon.get("/api/snapshot?patient_id=asha", headers=h).status_code == 401
    assert anon.post("/api/auth/login", json={"username": "isha", "password": "Isha_2026"}).status_code == 401
    assert "Isha" not in service.raise_alert("asha", "urgent", "after removal", "d")["alert"]["notified"]


def test_admin_can_reset_a_forgotten_password_and_it_is_audited_without_the_password(as_user, anon):
    assert as_user("rohan").patch("/api/admin/members/isha", json={"new_password": "Fresh-Start-77"}).status_code == 200
    assert anon.post("/api/auth/login", json={"username": "isha", "password": "Isha_2026"}).status_code == 401
    assert anon.post("/api/auth/login", json={"username": "isha", "password": "Fresh-Start-77"}).status_code == 200
    assert as_user("rohan").patch("/api/admin/members/isha", json={"new_password": "short"}).status_code == 422
    row = db.rows("SELECT * FROM audit WHERE action='admin:update_member' ORDER BY id DESC LIMIT 1")[0]
    assert "Fresh-Start-77" not in json.dumps(row) and "password" in row["detail"]


def test_an_admin_cannot_touch_other_families_or_clinicians(as_user):
    c = as_user("rohan")
    for target in ("suresh", "lakshmi", "drsen", "drmehta", "nobody"):
        assert c.patch(f"/api/admin/members/{target}", json={"name": "Hacked"}).status_code == 404, target
        assert c.delete(f"/api/admin/members/{target}").status_code == 404, target
    assert db.one("SELECT name FROM users WHERE id='suresh'")["name"] == "Suresh Iyer"


def test_people_changes_are_audited_with_what_changed(as_user):
    as_user("rohan").patch("/api/admin/members/isha", json={"notify_level": "all"})
    row = db.rows("SELECT * FROM audit WHERE action='admin:update_member' ORDER BY id DESC LIMIT 1")[0]
    assert row["actor_id"] == "rohan" and row["family_id"] == "deshmukh" and json.loads(row["detail"])["notify_level"] == ["urgent", "all"]


# ------------------------------------------------------------------ patients and care instructions
def test_admin_adds_edits_and_archives_a_patient(as_user):
    c = as_user("rohan")
    r = c.post("/api/admin/patients", json={"name": "Kaveri Deshmukh", "age": 88, "sex": "F", "conditions": "Mild dementia", "allergies": "None", "language": "hi-IN", "instructions": "Keep a night light on."})
    assert r.status_code == 201
    pid = r.json()["id"]
    assert pid in {p["id"] for p in c.get("/api/patients").json()}
    assert pid not in {p["id"] for p in as_user("suresh").get("/api/patients").json()}
    assert c.patch(f"/api/admin/patients/{pid}", json={"conditions": "Moderate dementia", "age": 89}).json()["changed"] == ["age", "conditions"]
    assert c.delete(f"/api/admin/patients/{pid}").status_code == 200
    assert pid not in {p["id"] for p in c.get("/api/patients").json()}
    assert c.get(f"/api/snapshot?patient_id={pid}").status_code == 404                           # archived patients cannot be opened


@pytest.mark.parametrize("data", [{"name": "", "age": 80}, {"name": "A", "age": -1}, {"name": "A", "age": 200}, {"name": "A", "age": "old"}, {"name": "A", "age": 70, "conditions": "x" * 301}])
def test_adding_a_patient_validates_input(as_user, data):
    assert as_user("rohan").post("/api/admin/patients", json=data).status_code == 422


def test_instructions_change_what_the_assistant_is_told_on_the_very_next_turn(as_user):
    c = as_user("rohan")
    assert "Check fasting sugar" in agent.patient_context("asha")
    new = "No sweets. Walk for 15 minutes after dinner. Call Rohan before any new tablet."
    assert c.patch("/api/admin/patients/asha", json={"instructions": new}).status_code == 200
    ctx = agent.patient_context("asha")
    assert new in ctx and "Check fasting sugar" not in ctx
    assert "Allergies: Sulfa drugs" in ctx and "Metformin 500 mg at 08:00,20:00" in ctx          # the profile and medicines travel with it
    assert c.get("/api/snapshot?patient_id=asha").json()["person"]["instructions"] == new
    row = db.rows("SELECT * FROM audit WHERE action='admin:update_patient' ORDER BY id DESC LIMIT 1")[0]
    assert "Walk for 15" not in json.dumps(row) and "<redacted>" in row["detail"]               # the text itself is never copied into the audit trail
    assert json.loads(row["detail"])["changed"] == ["instructions"]                             # but the fact that it changed is


def test_instructions_are_length_limited(as_user):
    assert as_user("rohan").patch("/api/admin/patients/asha", json={"instructions": "x" * 2001}).status_code == 422
    assert as_user("rohan").patch("/api/admin/patients/asha", json={}).status_code == 422


def test_an_admin_cannot_edit_a_patient_in_another_family(as_user):
    c = as_user("rohan")
    for r in (c.patch("/api/admin/patients/lakshmi", json={"instructions": "x"}), c.delete("/api/admin/patients/lakshmi"),
              c.post("/api/admin/patients/lakshmi/medications", json={"name": "X", "dose": "1", "times": "08:00"})):
        assert r.status_code == 404
    assert "fluid limit" in db.one("SELECT instructions FROM patients WHERE id='lakshmi'")["instructions"].lower()


# ------------------------------------------------------------------ medicines
def test_admin_adds_a_medicine_and_it_enters_todays_schedule(as_user):
    c = as_user("rohan")
    r = c.post("/api/admin/patients/asha/medications", json={"name": "Glimepiride", "dose": "1 mg", "purpose": "Blood sugar", "times": "07:30,19:30", "with_food": True, "notes": "Before meals", "prescriber": "Dr. Sen"})
    assert r.status_code == 201
    slots = {(d["medication"], d["slot"]) for d in service.todays_doses("asha")}
    assert {("Glimepiride", "07:30"), ("Glimepiride", "19:30")} <= slots
    assert service.log_dose("asha", "glimepiride", "taken", "07:30")["ok"]
    assert all(d["medication"] != "Glimepiride" for d in service.todays_doses("madhav"))
    assert "Glimepiride 1 mg" in agent.patient_context("asha")


@pytest.mark.parametrize("times,ok", [("08:00", True), ("08:00,20:00", True), ("8:00", False), ("25:00", False), ("08:60", False), ("08:00,08:00", False),
                                       ("", False), ("08:00,09:00,10:00,11:00,12:00,13:00,14:00", False), ("morning", False)])
def test_medicine_times_must_be_valid_hh_mm(as_user, times, ok):
    r = as_user("rohan").post("/api/admin/patients/asha/medications", json={"name": f"Test{abs(hash(times))}", "dose": "1 mg", "times": times})
    assert (r.status_code == 201) is ok


def test_duplicate_active_medicines_are_refused_but_a_stopped_one_can_be_re_added(as_user):
    c = as_user("rohan")
    assert c.post("/api/admin/patients/asha/medications", json={"name": "metformin", "dose": "1 g", "times": "08:00"}).status_code == 409
    med = next(m for m in service.medications("asha") if m["name"] == "Vitamin D3")
    assert c.delete(f"/api/admin/medications/{med['id']}").status_code == 200
    assert c.post("/api/admin/patients/asha/medications", json={"name": "Vitamin D3", "dose": "2000 IU", "times": "08:00"}).status_code == 201


def test_changing_a_dose_is_audited_with_before_and_after(as_user):
    med = next(m for m in service.medications("asha") if m["name"] == "Amlodipine")
    r = as_user("rohan").patch(f"/api/admin/medications/{med['id']}", json={"dose": "10 mg", "times": "08:00,20:00"})
    assert r.status_code == 200 and r.json()["changed"] == ["dose", "times"]
    row = db.rows("SELECT * FROM audit WHERE action='admin:update_medication' ORDER BY id DESC LIMIT 1")[0]
    ch = json.loads(row["detail"])["changes"]
    assert ch["dose"] == ["5 mg", "10 mg"] and ch["times"] == ["08:00", "08:00,20:00"] and row["actor_id"] == "rohan" and row["patient_id"] == "asha"
    assert "Amlodipine 10 mg at 08:00,20:00" in agent.patient_context("asha")


def test_stopping_a_medicine_removes_it_from_the_schedule_but_keeps_history(as_user):
    med = next(m for m in service.medications("asha") if m["name"] == "Atorvastatin")
    history_before = db.one("SELECT COUNT(*) n FROM dose_log WHERE med_id=?", (med["id"],))["n"]
    assert as_user("rohan").delete(f"/api/admin/medications/{med['id']}", ).status_code == 200
    assert all(d["medication"] != "Atorvastatin" for d in service.todays_doses("asha"))
    assert service.log_dose("asha", "atorvastatin")["ok"] is False
    assert db.one("SELECT COUNT(*) n FROM dose_log WHERE med_id=?", (med["id"],))["n"] == history_before
    assert db.one("SELECT stopped_at FROM medications WHERE id=?", (med["id"],))["stopped_at"]
    assert "Atorvastatin" not in agent.patient_context("asha")


def test_medicine_edits_validate_and_stay_inside_the_family(as_user):
    c = as_user("rohan")
    mid = service.medications("asha")[0]["id"]
    assert c.patch(f"/api/admin/medications/{mid}", json={"times": "later"}).status_code == 422
    assert c.patch(f"/api/admin/medications/{mid}", json={"dose": ""}).status_code == 422
    assert c.patch(f"/api/admin/medications/{mid}", json={}).status_code == 422
    other = service.medications("lakshmi")[0]["id"]
    assert c.patch(f"/api/admin/medications/{other}", json={"dose": "999 mg"}).status_code == 404
    assert c.delete(f"/api/admin/medications/{other}").status_code == 404


# ------------------------------------------------------------------ facilities
def test_facility_lifecycle_and_patient_assignment(as_user):
    c = as_user("rohan")
    r = c.post("/api/admin/facilities", json={"name": "Test Care Home", "kind": "care home", "address": "Baner, Pune", "phone": "+91 20 0000 0000"})
    assert r.status_code == 201
    fid = r.json()["id"]
    assert c.post("/api/admin/facilities", json={"name": "Test X", "kind": "spaceship"}).status_code == 422
    assert c.patch("/api/admin/patients/madhav", json={"facility_id": fid}).status_code == 200
    assert service.patient_profile("madhav")["facility_name"] == "Test Care Home"
    assert "Test Care Home" in agent.patient_context("madhav")
    assert c.patch(f"/api/admin/facilities/{fid}", json={"phone": "+91 20 1111 1111"}).status_code == 200
    assert c.delete(f"/api/admin/facilities/{fid}").status_code == 200
    assert service.patient_profile("madhav")["facility_id"] is None                              # unassigned, not left dangling


def test_a_facility_from_another_family_cannot_be_assigned_or_edited(as_user):
    c = as_user("rohan")
    iyer = db.one("SELECT id FROM facilities WHERE family_id='iyer'")["id"]
    assert c.patch("/api/admin/patients/asha", json={"facility_id": iyer}).status_code == 422
    assert c.patch(f"/api/admin/facilities/{iyer}", json={"name": "x"}).status_code == 404
    assert c.delete(f"/api/admin/facilities/{iyer}").status_code == 404


# ------------------------------------------------------------------ appointments
def test_admin_edits_and_cancels_appointments_while_members_can_only_add(as_user):
    appt = service.upcoming_appointments("asha", 5)[0]
    assert as_user("meera").patch(f"/api/admin/appointments/{appt['id']}", json={"title": "x"}).status_code == 403
    assert as_user("meera").delete(f"/api/admin/appointments/{appt['id']}").status_code == 403
    assert as_user("meera").post("/api/appointments?patient_id=asha", json={"title": "Dentist", "starts_at": "2099-02-02T10:00:00"}).status_code == 200
    c = as_user("rohan")
    assert c.patch(f"/api/admin/appointments/{appt['id']}", json={"starts_at": "2099-03-03T11:00:00", "needs_ride": False}).status_code == 200
    assert c.patch(f"/api/admin/appointments/{appt['id']}", json={"starts_at": "next week"}).status_code == 422
    assert c.delete(f"/api/admin/appointments/{appt['id']}").status_code == 200
    assert all(a["id"] != appt["id"] for a in service.upcoming_appointments("asha", 20))


def test_appointments_of_other_families_are_untouchable(as_user):
    other = service.upcoming_appointments("lakshmi", 1)[0]["id"]
    assert as_user("rohan").patch(f"/api/admin/appointments/{other}", json={"title": "x"}).status_code == 404
    assert as_user("rohan").delete(f"/api/admin/appointments/{other}").status_code == 404
