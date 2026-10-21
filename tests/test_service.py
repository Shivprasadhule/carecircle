"""Care logic for one patient at a time (service layer)."""
from datetime import datetime, timedelta

import pytest

from carecircle import db, service

ASHA, MADHAV = "asha", "madhav"


def _vital_series(pid, kind, values, value2=None, unit=""):
    """Insert one reading per day ending yesterday, oldest first."""
    with db.conn() as c:
        c.execute("DELETE FROM vitals WHERE patient_id=? AND kind=?", (pid, kind))
        for i, v in enumerate(values):
            day = (db.now().date() - timedelta(days=len(values) - i)).isoformat()
            c.execute("INSERT INTO vitals (patient_id,ts,kind,value,value2,unit) VALUES (?,?,?,?,?,?)", (pid, f"{day}T08:30:00", kind, v, value2, unit))


def _kinds(pid):
    return {s["signal"]: s["severity"] for s in service.evaluate_signals(pid)["signals"]}


# ------------------------------------------------------------------ medicines
def test_todays_doses_follow_the_care_clock():
    by = {(d["medication"], d["slot"]): d["status"] for d in service.todays_doses(ASHA)}
    assert by[("Amlodipine", "08:00")] == "overdue"          # 12:00 is more than 90 minutes after 08:00
    assert by[("Metformin", "20:00")] == "upcoming"


def test_log_dose_picks_nearest_slot_and_will_not_tick_off_a_dose_hours_away():
    r = service.log_dose(ASHA, "metformin")
    assert r["ok"] and r["slot"] == "08:00" and r["status"] == "taken"
    again = service.log_dose(ASHA, "metformin")
    assert again["ok"] is False and "not due until 20:00" in again["error"]


def test_log_dose_validates_name_status_and_slot():
    assert "Metformin" in service.log_dose(ASHA, "unobtainium")["error"]
    assert service.log_dose(ASHA, "metformin", "maybe")["ok"] is False
    assert "no 09:00 dose" in service.log_dose(ASHA, "metformin", slot="09:00")["error"]


def test_a_medicine_belongs_to_one_patient():
    assert service.log_dose(MADHAV, "tamsulosin", "taken", "21:00")["ok"]
    assert service.log_dose(ASHA, "tamsulosin")["ok"] is False          # Madhav's medicine is not on Asha's list
    assert service.log_dose(MADHAV, "metformin")["ok"] is False


def test_adherence_counts_only_completed_days():
    adh = service.adherence(ASHA, 7)
    assert db.now().date().isoformat() not in adh["by_day"] and 0 <= adh["overall_pct"] <= 100


# ------------------------------------------------------------------ check-ins and vitals
def test_checkin_is_clamped_and_returns_signals():
    r = service.record_checkin(ASHA, mood=99, pain=-4, sleep_hours=6.5, note="ok")
    assert r["mood"] == 5 and r["pain"] == 0 and "signals" in r


@pytest.mark.parametrize("kind,value,value2,ok", [
    ("spo2", 94, None, True), ("spo2", 9, None, False), ("spo2", 130, None, False),
    ("glucose", 110, None, True), ("glucose", 5, None, False),
    ("bp", 130, 80, True), ("bp", 130, None, False), ("bp", 80, 130, False), ("bp", 300, 80, False),
    ("weight", 62.5, None, True), ("weight", 700, None, False), ("hr", 72, None, True), ("hr", 400, None, False),
    ("inr", 2.4, None, True), ("temperature", 37, None, False),
])
def test_record_vital_rejects_implausible_readings(kind, value, value2, ok):
    assert service.record_vital(ASHA, kind, value, value2)["ok"] is ok


def test_vitals_are_stored_per_patient():
    service.record_vital(ASHA, "weight", 61.0)
    assert service.recent_vitals(ASHA, 1)["weight"][-1]["value"] == 61.0
    assert all(r["value"] != 61.0 for r in service.recent_vitals(MADHAV, 1).get("weight", []))


# ------------------------------------------------------------------ signals: each rule fires at its threshold and not below it
@pytest.mark.parametrize("values,expected", [
    ([95, 95, 94], None), ([95, 93, 91.5], "high"), ([95, 94, 86], "urgent"),
])
def test_oxygen_thresholds(values, expected):
    _vital_series("abdul", "spo2", values, unit="%")
    got = _kinds("abdul").get("low_oxygen")
    assert got == expected


def test_oxygen_slowly_drifting_down_is_a_watch_even_above_92():
    _vital_series("abdul", "spo2", [97, 96, 95, 94, 93])
    assert _kinds("abdul").get("oxygen_trending_down") == "watch"
    db.reset("decline", "khan")


@pytest.mark.parametrize("readings,signal,severity", [
    ([110, 118, 64], "low_blood_sugar", "high"), ([110, 120, 310], "high_blood_sugar", "high"),
    ([110, 120, 260], "high_blood_sugar", "watch"), ([110, 120, 130], None, None),
])
def test_blood_sugar_thresholds(readings, signal, severity):
    _vital_series("arun", "glucose", readings, unit="mg/dL")
    k = _kinds("arun")
    if signal:
        assert k.get(signal) == severity
    else:
        assert not {"low_blood_sugar", "high_blood_sugar"} & set(k)
    db.reset("decline", "banerjee")


@pytest.mark.parametrize("sys_,dia,signal,severity", [
    (125, 80, None, None), (165, 90, "high_bp", "watch"), (150, 102, "high_bp", "watch"), (185, 100, "very_high_bp", "high"), (85, 55, "low_bp", "watch"),
])
def test_blood_pressure_thresholds(sys_, dia, signal, severity):
    _vital_series(ASHA, "bp", [sys_], value2=dia)
    k = _kinds(ASHA)
    assert (k.get(signal) == severity) if signal else not {"high_bp", "very_high_bp", "low_bp"} & set(k)


@pytest.mark.parametrize("series,signal,severity", [
    ([62, 62.1, 62], None, None), ([62, 62.3, 63.6], "weight_rising", "watch"), ([62, 62.5, 63, 64.2], "rapid_weight_gain", "high"),
])
def test_weight_gain_thresholds_for_fluid_retention(series, signal, severity):
    _vital_series("sudipta", "weight", series, unit="kg")
    k = _kinds("sudipta")
    assert (k.get(signal) == severity) if signal else not {"weight_rising", "rapid_weight_gain"} & set(k)
    db.reset("decline", "banerjee")


def test_inr_outside_target_is_flagged_for_the_warfarin_patient():
    _vital_series(MADHAV, "inr", [2.4, 2.6, 4.1])
    assert _kinds(MADHAV).get("inr_out_of_range") == "high"
    _vital_series(MADHAV, "inr", [2.4, 2.6, 2.5])
    assert "inr_out_of_range" not in _kinds(MADHAV)


def test_several_soft_signals_together_become_a_compound_decline():
    assert _kinds(ASHA).get("compound_decline") == "high"
    db.reset("stable", "deshmukh")
    assert "compound_decline" not in _kinds(ASHA)


# ------------------------------------------------------------------ alerts
def test_alert_goes_to_the_patients_family_by_preference_and_never_to_other_families():
    a = service.raise_alert(ASHA, "watch", "Low mood", "detail")["alert"]
    names = a["notified"]
    assert "Rohan" in names and "Meera" in names and "Isha" not in names        # Isha is 'urgent only'; low-severity skips her
    assert not any(n in names for n in ("Suresh", "Imran", "Vikram", "Jacob", "Soumya"))      # no other family is ever told
    assert "Dr. Sen" not in names                                              # clinicians only hear high/urgent


def test_high_alerts_also_reach_urgent_only_members_and_assigned_clinicians_across_families():
    a = service.raise_alert(ASHA, "high", "Possible fall", "d")["alert"]["notified"]
    assert all(n in a for n in ("Rohan", "Meera", "Isha", "Dr. Sen", "Dr. Mehta"))     # Mehta is assigned to Asha too
    assert "Dr. Raman" not in a


def test_alert_dedupes_and_validates_severity_and_is_per_patient():
    first = service.raise_alert(ASHA, "watch", "Same title", "d")
    assert service.raise_alert(ASHA, "watch", "Same title", "d").get("deduplicated") is True
    assert service.raise_alert(MADHAV, "watch", "Same title", "d").get("deduplicated") is None     # same title, different patient
    assert service.raise_alert(ASHA, "catastrophic", "x", "y")["ok"] is False
    assert len(service.list_alerts(ASHA)) == 1 and len(service.list_alerts(MADHAV)) == 1
    assert first["alert"]["patient_id"] == ASHA


def test_resolving_an_alert_only_works_for_the_patient_it_belongs_to():
    a = service.raise_alert(ASHA, "high", "t", "d")["alert"]
    assert "No open alert" in service.resolve_alert(MADHAV, a["id"]).get("note", "")      # wrong patient: no effect
    assert len(service.list_alerts(ASHA)) == 1
    service.resolve_alert(ASHA, a["id"], "called her")
    assert service.list_alerts(ASHA) == []


# ------------------------------------------------------------------ memories, appointments, snapshot
def test_memories_are_private_to_each_patient():
    service.remember(ASHA, "Likes jasmine tea in the evening")
    assert service.recall(ASHA, 1)[0]["content"].startswith("Likes jasmine")
    assert all("jasmine" not in m["content"] for m in service.recall(MADHAV, 50))


def test_appointments_carry_a_human_when_and_belong_to_one_patient():
    appts = service.upcoming_appointments(ASHA, 3)
    assert appts and all("when" in a for a in appts) and all(a["patient_id"] == ASHA for a in appts)
    assert service.humanize_when("2026-10-23T10:30:00", datetime(2026, 10, 21, 9, 0)) == "Friday 23 October, 10:30 (in 2 days)"
    assert service.humanize_when("2026-10-22T08:00:00", datetime(2026, 10, 21, 9, 0)).endswith("(tomorrow)")
    assert service.schedule_appointment(ASHA, "x", "next tuesday")["ok"] is False
    booked = service.schedule_appointment(ASHA, "Dentist", "2099-01-01T09:00:00", needs_ride=True)
    assert booked["ok"] and booked["when"].startswith("Thursday 01 January")
    assert all(a["title"] != "Dentist" for a in service.upcoming_appointments(MADHAV, 20))


def test_snapshot_has_the_profile_instructions_vitals_and_care_circle():
    s = service.snapshot(ASHA)
    assert s["person"]["name"] == "Asha Deshmukh" and "fasting sugar" in s["person"]["instructions"]
    assert s["person"]["facility_name"] == "Sen Clinic, Kothrud"
    assert {c["name"] for c in s["caregivers"]} == {"Rohan Deshmukh", "Meera Kulkarni", "Isha Kulkarni"}
    assert {"glucose", "bp"} <= set(s["vitals"]) and s["medications"] and s["clinicians"][0]["name"] in {"Dr. Sen", "Dr. Mehta"}
    for k in ("now", "person", "caregivers", "doses_today", "next_appointments", "open_alerts", "latest_checkin", "checkins_7d", "adherence", "signals", "memories"):
        assert k in s


def test_snapshot_for_hides_alerts_from_patients_and_phone_numbers_from_non_family():
    from carecircle import auth
    service.raise_alert(ASHA, "high", "Family only", "d")
    assert service.snapshot_for(auth.build_actor("rohan"), ASHA)["open_alerts"]
    patient_view = service.snapshot_for(auth.build_actor("asha"), ASHA)
    assert patient_view["open_alerts"] == [] and all("phone" not in c for c in patient_view["caregivers"])
    assert any(c.get("phone") for c in service.snapshot_for(auth.build_actor("rohan"), ASHA)["caregivers"])


def test_patients_overview_lists_only_what_the_account_may_see_with_a_risk_level():
    from carecircle import auth
    ov = {p["id"]: p for p in service.patients_overview(auth.build_actor("rohan"))}
    assert set(ov) == {"asha", "madhav"} and ov["asha"]["level"] in {"watch", "high"}
    assert {p["id"] for p in service.patients_overview(auth.build_actor("drmehta"))} == {"kamla", "asha"}
    assert [p["id"] for p in service.patients_overview(auth.build_actor("thomas"))] == ["thomas"]


def test_urgent_alerts_carry_the_emergency_number_and_forbid_false_reassurance():
    urgent = service.raise_alert(ASHA, "urgent", "Fall", "Asha fell")
    assert "112" in urgent["say_next"] and "108" in urgent["say_next"] and "Never say or imply that help is on the way" in urgent["say_next"]
    high = service.raise_alert(MADHAV, "high", "Bleeding", "d")
    assert "doctor today" in high["say_next"] and "112" not in high["say_next"]
    assert "say_next" not in service.raise_alert("arun", "watch", "Low mood", "d")                  # no emergency script for a routine alert


@pytest.mark.parametrize("text", [
    "Asha slipped and fell in the bathroom", "Possible fall, cannot get up", "Chest pain and sweating", "Trouble breathing at night", "Signs of a stroke: slurred speech",
    "Found unconscious on the floor", "Heavy bleeding from a cut", "Collapsed in the kitchen",
])
def test_emergency_wording_is_always_upgraded_to_urgent_even_if_the_model_said_high(text):
    r = service.raise_alert(ASHA, "high", text, "d")
    assert r["alert"]["severity"] == "urgent" and r["escalated"] is True and "112" in r["say_next"]
    db.reset("decline", "deshmukh")


@pytest.mark.parametrize("text", [
    "Mood and sleep falling over three days", "A fall in blood pressure readings", "Missed doses and falling adherence", "Weight rising, possible fluid build-up",
    "Strokes of luck", "She felt faint-hearted about the appointment",
])
def test_ordinary_wording_is_not_escalated(text):
    r = service.raise_alert(ASHA, "watch", text, "d")
    assert r["alert"]["severity"] == "watch" and "escalated" not in r
    db.reset("decline", "deshmukh")


def test_the_safety_net_never_lowers_a_severity():
    assert service.raise_alert(ASHA, "urgent", "Mood slightly low", "d")["alert"]["severity"] == "urgent"
