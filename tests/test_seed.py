"""The synthetic dataset: breadth, realism and internal consistency."""
import re

import pytest

from carecircle import auth, db, seed_data, service


def test_six_families_ten_patients_and_at_least_twenty_accounts():
    assert db.one("SELECT COUNT(*) n FROM families")["n"] == 6
    assert db.one("SELECT COUNT(*) n FROM patients WHERE active=1")["n"] == 10
    assert db.one("SELECT COUNT(*) n FROM users WHERE active=1")["n"] >= 20
    roles = {r["role"]: r["n"] for r in db.rows("SELECT role, COUNT(*) n FROM users GROUP BY role")}
    assert roles["admin"] == 6 and roles["clinician"] == 7 and roles["person"] >= 8 and roles["family"] >= 6


def test_every_family_has_exactly_the_structure_we_promise():
    for f in db.rows("SELECT id FROM families"):
        admins = db.rows("SELECT id FROM users WHERE family_id=? AND role='admin' AND active=1", (f["id"],))
        pats = db.rows("SELECT id FROM patients WHERE family_id=? AND active=1", (f["id"],))
        assert len(admins) >= 1 and len(pats) >= 1, f["id"]


def test_some_families_have_more_than_one_patient():
    multi = db.rows("SELECT family_id, COUNT(*) n FROM patients GROUP BY family_id HAVING n > 1")
    assert {m["family_id"] for m in multi} >= {"deshmukh", "khan", "nair", "banerjee"}


def test_conditions_are_diverse():
    text = " ".join(p["conditions"].lower() for p in db.rows("SELECT conditions FROM patients"))
    for needle in ["diabetes", "copd", "kidney", "alzheimer", "parkinson", "heart failure", "stroke", "thyroid", "osteoarthritis"]:
        assert needle in text, needle


def test_every_patient_has_medicines_history_appointments_instructions_and_a_facility():
    for p in db.rows("SELECT * FROM patients"):
        pid = p["id"]
        assert len(service.medications(pid)) >= 3, pid
        assert len(service.recent_checkins(pid, 8)) == 7, pid
        assert service.recent_vitals(pid, 14), pid
        assert db.rows("SELECT 1 FROM appointments WHERE patient_id=?", (pid,)), pid
        assert len(p["instructions"]) > 80 and p["facility_id"], pid
        assert p["allergies"], pid


def test_every_medicine_has_a_dose_a_purpose_and_valid_times():
    for m in db.rows("SELECT * FROM medications"):
        assert m["dose"] and m["purpose"], m["name"]
        assert all(re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", t) for t in m["times"].split(",")), m
        assert m["prescriber"], m["name"]


def test_demo_passwords_follow_the_documented_rule_and_are_hashed():
    assert seed_data.demo_password("Asha Deshmukh") == "Asha_2026"
    assert seed_data.demo_password("Dr. Sen") == "Sen_2026"
    assert seed_data.demo_password("Dr. Varghese") == "Varghese_2026"
    for u in db.rows("SELECT id, name, password_hash FROM users"):
        assert u["password_hash"].startswith("scrypt$"), u["id"]
        assert seed_data.demo_password(u["name"]) not in u["password_hash"]
        assert auth.login(u["id"], seed_data.demo_password(u["name"])).id == u["id"]


def test_usernames_are_unique_lowercase_and_clinicians_are_assigned_across_families():
    ids = [u["id"] for u in db.rows("SELECT id FROM users")]
    assert len(ids) == len(set(ids)) and all(i == i.lower() for i in ids)
    drmehta = auth.build_actor("drmehta")
    families = {db.one("SELECT family_id FROM patients WHERE id=?", (p,))["family_id"] for p in drmehta.patients}
    assert families == {"gupta", "deshmukh"}                          # one geriatrician, patients in two households


def test_each_family_narrative_is_detected_by_the_signal_engine():
    """The seeded stories must surface as the right clinical flags (this is what the care watch reads)."""
    for fam in ("deshmukh", "iyer", "khan", "gupta", "nair", "banerjee"):
        db.reset("decline", fam)
    kinds = lambda pid: {s["signal"] for s in service.evaluate_signals(pid)["signals"]}      # noqa: E731
    assert "compound_decline" in kinds("asha")                                                # diabetes: mood, sleep, missed doses
    assert {"rapid_weight_gain"} <= kinds("sudipta") and "rapid_weight_gain" in kinds("lakshmi")   # heart failure and CKD: fluid
    assert {"low_oxygen"} & kinds("abdul")                                                    # COPD flare: oxygen falling
    assert "low_blood_sugar" in kinds("arun")                                                 # insulin: night-time low
    assert {"mood_decline", "missed_doses"} & kinds("thomas") or "sleep_decline" in kinds("thomas")   # Parkinson's wearing-off week
    assert service.evaluate_signals("zainab")["level"] in {"ok", "watch"}                    # the stable ones stay calm
    assert not {"low_oxygen", "rapid_weight_gain", "low_blood_sugar"} & kinds("mariamma")


@pytest.mark.parametrize("scenario,expect_history", [("decline", True), ("stable", True), ("fresh", False)])
def test_scenarios_regenerate_one_family(scenario, expect_history):
    db.reset(scenario, "iyer")
    assert bool(service.recent_checkins("lakshmi", 8)) is expect_history
    assert service.medications("lakshmi")                             # the care plan always exists
    assert service.recent_checkins("asha", 8)                         # other families untouched
    db.reset("decline", "iyer")


def test_stable_scenario_removes_the_trend_signals():
    db.reset("stable", "banerjee")
    kinds = {s["signal"] for s in service.evaluate_signals("sudipta")["signals"]}
    assert not kinds & {"rapid_weight_gain", "compound_decline", "mood_decline"}
    db.reset("decline", "banerjee")


def test_reset_rejects_unknown_scenarios():
    with pytest.raises(ValueError):
        db.reset("chaos", "deshmukh")
