"""Deterministic care logic, scoped to ONE patient (the `pid` argument).

The LLM decides *what to do*; everything that touches state or computes a health signal lives here so it is testable and never
hallucinated. Callers (REST routes, MCP tools) are responsible for checking the account may access `pid` before calling.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta
from statistics import mean

from . import db

SEVERITY_ORDER = {"info": 0, "watch": 1, "high": 2, "urgent": 3}
OVERDUE_AFTER_MIN = 90

UNVERIFIED_HELP_RE = re.compile(
    r"\b(?:has|have|had)\s+(?:already\s+)?called\s+(?:112|108|an?\s+ambulance|the\s+ambulance|emergency|the\s+police|for\s+(?:help|an?\s+ambulance))"
    r"|\bambulance\s+(?:is\s+)?(?:on\s+(?:its|the)\s+way|coming|called|dispatched)\b|\bhelp\s+(?:is\s+)?(?:on\s+(?:its|the)\s+way|coming)\b", re.I)

# Unmistakable emergency phrases. The model decides severity, but this net only ever ESCALATES (never lowers), so a fall or chest pain
# filed as "high" still gets the urgent script. Deliberately narrow: "falling mood" or "a fall in blood pressure" must not match.
EMERGENCY_RE = re.compile(
    r"\b(chest pain|crushing pain|pain in (?:her|his|the) chest|can'?t breathe|cannot breathe|unable to breathe|trouble breathing|difficulty breathing|"
    r"struggling to breathe|stroke|face droop|slurred speech|unconscious|unresponsive|collapsed|fainted|passed out|seizure|convulsion|"
    r"heavy bleeding|bleeding heavily|overdose|fell|has fallen|had fallen|had a fall|slipped and fell|can'?t get up|cannot get up|on the floor)\b", re.I)

# plausibility limits: reject typos like "spo2 9" or "weight 700" before they raise false alarms
VITAL_RANGES = {"spo2": (50, 100, "%"), "glucose": (20, 600, "mg/dL"), "hr": (20, 220, "bpm"), "weight": (20, 250, "kg"), "inr": (0.5, 8, ""),
                "bp": (60, 260, "mmHg")}


# ---------------------------------------------------------------- patient profile
def patient_profile(pid: str) -> dict | None:
    p = db.one(
        """SELECT p.id, p.family_id, p.name, p.age, p.sex, p.conditions, p.allergies, p.language, p.instructions, p.facility_id,
                  f.name AS facility_name, f.kind AS facility_kind, f.address AS facility_address, f.phone AS facility_phone
           FROM patients p LEFT JOIN facilities f ON f.id=p.facility_id WHERE p.id=? AND p.active=1""", (pid,))
    return p


# ---------------------------------------------------------------- medications
def _slot_dt(day: str, slot: str) -> datetime:
    return datetime.fromisoformat(f"{day}T{slot}:00")


def medications(pid: str, include_stopped: bool = False) -> list[dict]:
    q = "SELECT * FROM medications WHERE patient_id=?" + ("" if include_stopped else " AND active=1") + " ORDER BY name"
    return db.rows(q, (pid,))


def todays_doses(pid: str, at: datetime | None = None) -> list[dict]:
    at = at or db.now()
    day = at.date().isoformat()
    meds = db.rows("SELECT * FROM medications WHERE patient_id=? AND active=1 ORDER BY id", (pid,))
    logs = {(r["med_id"], r["slot"]): r for r in db.rows(
        "SELECT d.* FROM dose_log d JOIN medications m ON m.id=d.med_id WHERE m.patient_id=? AND d.day=?", (pid, day))}
    out = []
    for m in meds:
        for slot in m["times"].split(","):
            log = logs.get((m["id"], slot))
            sched = _slot_dt(day, slot)
            if log:
                status = log["status"]
            elif at >= sched + timedelta(minutes=OVERDUE_AFTER_MIN):
                status = "overdue"
            elif at >= sched - timedelta(minutes=30):
                status = "due"
            else:
                status = "upcoming"
            out.append({"med_id": m["id"], "medication": m["name"], "dose": m["dose"], "purpose": m["purpose"], "slot": slot, "status": status,
                        "with_food": bool(m["with_food"]), "notes": m["notes"]})
    return sorted(out, key=lambda d: (d["slot"], d["medication"]))


def _find_med(pid: str, name: str) -> dict | None:
    name = name.strip().lower()
    for m in db.rows("SELECT * FROM medications WHERE patient_id=? AND active=1", (pid,)):
        if name == m["name"].lower() or name in m["name"].lower() or m["name"].lower() in name:
            return m
    return None


def log_dose(pid: str, medication: str, status: str = "taken", slot: str | None = None) -> dict:
    status = status.lower()
    if status not in {"taken", "missed", "skipped"}:
        return {"ok": False, "error": "status must be taken, missed or skipped"}
    m = _find_med(pid, medication)
    if not m:
        names = ", ".join(x["name"] for x in db.rows("SELECT name FROM medications WHERE patient_id=? AND active=1", (pid,)))
        return {"ok": False, "error": f"No medication matching '{medication}'. Known: {names}"}
    at = db.now()
    day = at.date().isoformat()
    slots = m["times"].split(",")
    if slot is None:
        logged = {r["slot"] for r in db.rows("SELECT slot FROM dose_log WHERE med_id=? AND day=?", (m["id"], day))}
        pending = [s for s in slots if s not in logged]
        if not pending:
            return {"ok": True, "note": f"All of today's {m['name']} doses are already logged.", "medication": m["name"]}
        # Don't let "I took my tablet" silently tick off a dose that is hours away.
        pending = [s for s in pending if _slot_dt(day, s) <= at + timedelta(hours=2)]
        if not pending:
            nxt = min(s for s in slots if s not in logged)
            return {"ok": False, "error": f"{m['name']} is not due until {nxt}; nothing to log yet.", "medication": m["name"]}
        slot = min(pending, key=lambda s: abs((_slot_dt(day, s) - at).total_seconds()))
    elif slot not in slots:
        return {"ok": False, "error": f"{m['name']} has no {slot} dose. Its times are {', '.join(slots)}."}
    with db.conn() as c:
        c.execute(
            "INSERT INTO dose_log (med_id,day,slot,status,logged_at) VALUES (?,?,?,?,?) "
            "ON CONFLICT(med_id,day,slot) DO UPDATE SET status=excluded.status, logged_at=excluded.logged_at",
            (m["id"], day, slot, status, at.isoformat()),
        )
    return {"ok": True, "medication": m["name"], "dose": m["dose"], "slot": slot, "status": status,
            "with_food": bool(m["with_food"]), "notes": m["notes"], "doses_today": todays_doses(pid)}


def adherence(pid: str, days: int = 7) -> dict:
    since = (db.now().date() - timedelta(days=days)).isoformat()
    today = db.now().date().isoformat()
    logs = db.rows("SELECT d.*, m.name FROM dose_log d JOIN medications m ON m.id=d.med_id WHERE m.patient_id=? AND d.day>=? AND d.day<?", (pid, since, today))
    per_day: dict[str, list[int]] = {}
    per_med: dict[str, list[int]] = {}
    for r in logs:
        ok = 1 if r["status"] == "taken" else 0
        per_day.setdefault(r["day"], []).append(ok)
        per_med.setdefault(r["name"], []).append(ok)
    overall = round(100 * mean(x for v in per_day.values() for x in v), 1) if per_day else None
    return {
        "overall_pct": overall,
        "by_day": {d: round(100 * mean(v)) for d, v in sorted(per_day.items())},
        "by_medication": {m: round(100 * mean(v)) for m, v in per_med.items()},
        "missed_doses": [{"day": r["day"], "medication": r["name"], "slot": r["slot"]} for r in logs if r["status"] != "taken"],
    }


# ---------------------------------------------------------------- check-ins and vitals
def record_checkin(pid: str, mood: int, pain: int = 0, sleep_hours: float | None = None, note: str = "") -> dict:
    mood = max(1, min(5, int(mood)))
    pain = max(0, min(10, int(pain)))
    ts = db.now().isoformat()
    with db.conn() as c:
        c.execute("INSERT INTO checkins (patient_id,ts,mood,pain,sleep_hours,note) VALUES (?,?,?,?,?,?)", (pid, ts, mood, pain, sleep_hours, note))
    return {"ok": True, "ts": ts, "mood": mood, "pain": pain, "sleep_hours": sleep_hours, "note": note, "signals": evaluate_signals(pid)}


def recent_checkins(pid: str, days: int = 7) -> list[dict]:
    since = (db.now() - timedelta(days=days)).isoformat()
    return db.rows("SELECT * FROM checkins WHERE patient_id=? AND ts>=? ORDER BY ts", (pid, since))


def record_vital(pid: str, kind: str, value: float, value2: float | None = None, unit: str | None = None) -> dict:
    kind = kind.lower().strip()
    if kind not in VITAL_RANGES:
        return {"ok": False, "error": f"kind must be one of {', '.join(VITAL_RANGES)}"}
    lo, hi, default_unit = VITAL_RANGES[kind]
    if not lo <= float(value) <= hi:
        return {"ok": False, "error": f"{kind} of {value} looks wrong (expected {lo}-{hi}). Ask them to repeat the reading."}
    if kind == "bp":
        if value2 is None or not 30 <= float(value2) <= 160 or float(value2) >= float(value):
            return {"ok": False, "error": "Blood pressure needs systolic and diastolic, e.g. 130 over 80."}
    ts = db.now().isoformat()
    with db.conn() as c:
        c.execute("INSERT INTO vitals (patient_id,ts,kind,value,value2,unit) VALUES (?,?,?,?,?,?)", (pid, ts, kind, float(value), None if value2 is None else float(value2), unit or default_unit))
    return {"ok": True, "kind": kind, "value": float(value), "value2": value2, "unit": unit or default_unit, "ts": ts, "signals": evaluate_signals(pid)}


def recent_vitals(pid: str, days: int = 14) -> dict[str, list[dict]]:
    since = (db.now() - timedelta(days=days)).isoformat()
    out: dict[str, list[dict]] = {}
    for r in db.rows("SELECT kind, ts, value, value2, unit FROM vitals WHERE patient_id=? AND ts>=? ORDER BY ts", (pid, since)):
        out.setdefault(r["kind"], []).append(r)
    return out


# ---------------------------------------------------------------- appointments
def humanize_when(iso: str, today: datetime | None = None) -> str:
    """'Friday 23 October, 10:30' (+ 'today'/'tomorrow'), so the model never has to compute weekdays itself."""
    d = datetime.fromisoformat(iso)
    days = (d.date() - (today or db.now()).date()).days
    rel = {0: "today", 1: "tomorrow"}.get(days, f"in {days} days" if days > 1 else "")
    return f"{d.strftime('%A %d %B')}, {d.strftime('%H:%M')}" + (f" ({rel})" if rel else "")


def upcoming_appointments(pid: str, limit: int = 5) -> list[dict]:
    rows = db.rows(
        """SELECT a.*, f.name AS facility_name FROM appointments a LEFT JOIN facilities f ON f.id=a.facility_id
           WHERE a.patient_id=? AND a.status='scheduled' AND a.starts_at>=? ORDER BY a.starts_at LIMIT ?""",
        (pid, db.now().isoformat(), limit))
    for r in rows:
        r["when"] = humanize_when(r["starts_at"])
    return rows


def schedule_appointment(pid: str, title: str, starts_at: str, doctor: str = "", location: str = "", needs_ride: bool = False, notes: str = "",
                         facility_id: int | None = None) -> dict:
    try:
        when = datetime.fromisoformat(starts_at)
    except ValueError:
        return {"ok": False, "error": "starts_at must be ISO-8601, e.g. 2026-10-28T10:30:00"}
    with db.conn() as c:
        cur = c.execute("INSERT INTO appointments (patient_id,title,doctor,starts_at,facility_id,location,needs_ride,notes) VALUES (?,?,?,?,?,?,?,?)",
                        (pid, title, doctor, when.isoformat(), facility_id, location, int(needs_ride), notes))
    return {"ok": True, "id": cur.lastrowid, "title": title, "starts_at": when.isoformat(), "when": humanize_when(when.isoformat()), "doctor": doctor,
            "location": location, "needs_ride": needs_ride}


# ---------------------------------------------------------------- signals / trend analysis
def _slope(values: list[float]) -> float:
    n = len(values)
    if n < 3:
        return 0.0
    xs = list(range(n))
    mx, my = mean(xs), mean(values)
    den = sum((x - mx) ** 2 for x in xs)
    return sum((x - mx) * (y - my) for x, y in zip(xs, values)) / den if den else 0.0


def _vital_signals(pid: str) -> list[dict]:
    """Condition-agnostic red flags from the readings themselves (works for COPD, heart failure, CKD, diabetes, etc.)."""
    v = recent_vitals(pid, 7)
    sig: list[dict] = []

    def last(k): return v[k][-1] if v.get(k) else None
    if (s := v.get("spo2")):
        vals, cur = [r["value"] for r in s], s[-1]["value"]
        if cur < 88:
            sig.append({"signal": "low_oxygen", "severity": "urgent", "detail": f"Oxygen saturation is {cur:g}%, which is dangerously low."})
        elif cur < 92:
            sig.append({"signal": "low_oxygen", "severity": "high", "detail": f"Oxygen saturation fell from {vals[0]:g}% to {cur:g}%."})
        elif len(vals) >= 3 and _slope(vals) <= -0.8:
            sig.append({"signal": "oxygen_trending_down", "severity": "watch", "detail": f"Oxygen saturation drifting down: {vals[0]:g}% to {cur:g}%."})
    if (g := v.get("glucose")):
        recent_low = [r for r in g if r["value"] < 70 and r["ts"] >= (db.now() - timedelta(days=3)).isoformat()]
        cur = g[-1]["value"]
        if recent_low:
            sig.append({"signal": "low_blood_sugar", "severity": "high", "detail": f"Low blood sugar of {recent_low[-1]['value']:g} mg/dL recorded on {recent_low[-1]['ts'][:10]}."})
        elif cur > 300:
            sig.append({"signal": "high_blood_sugar", "severity": "high", "detail": f"Blood sugar is {cur:g} mg/dL."})
        elif cur > 250:
            sig.append({"signal": "high_blood_sugar", "severity": "watch", "detail": f"Blood sugar is {cur:g} mg/dL."})
    if (b := last("bp")):
        sys_, dia = b["value"], b["value2"] or 0
        if sys_ >= 180 or dia >= 120:
            sig.append({"signal": "very_high_bp", "severity": "high", "detail": f"Blood pressure is {sys_:g}/{dia:g}."})
        elif sys_ >= 160 or dia >= 100:
            sig.append({"signal": "high_bp", "severity": "watch", "detail": f"Blood pressure is {sys_:g}/{dia:g}."})
        elif sys_ < 90:
            sig.append({"signal": "low_bp", "severity": "watch", "detail": f"Blood pressure is low at {sys_:g}/{dia:g}."})
    if (w := v.get("weight")) and len(w) >= 3:
        window = [r["value"] for r in w[-4:]]
        gain = window[-1] - min(window)
        if gain >= 2.0:
            sig.append({"signal": "rapid_weight_gain", "severity": "high", "detail": f"Weight is up {gain:.1f} kg in a few days ({min(window):g} to {window[-1]:g} kg), which can mean fluid build-up."})
        elif gain >= 1.5:
            sig.append({"signal": "weight_rising", "severity": "watch", "detail": f"Weight is up {gain:.1f} kg over the last few days."})
    if (h := last("hr")) and (h["value"] > 110 or h["value"] < 50):
        sig.append({"signal": "abnormal_heart_rate", "severity": "watch", "detail": f"Heart rate is {h['value']:g} bpm."})
    if (i := last("inr")) and (i["value"] < 2.0 or i["value"] > 3.5):
        sig.append({"signal": "inr_out_of_range", "severity": "high", "detail": f"INR is {i['value']:g}, outside the usual 2.0 to 3.0 target for warfarin."})
    return sig


def evaluate_signals(pid: str, days: int = 7) -> dict:
    """Combine adherence, mood, sleep, pain and vitals into explainable risk signals."""
    checks = recent_checkins(pid, days)
    adh = adherence(pid, days)
    signals: list[dict] = []

    if checks:
        moods = [c["mood"] for c in checks]
        sleeps = [c["sleep_hours"] for c in checks if c["sleep_hours"] is not None]
        pains = [c["pain"] for c in checks]
        if len(moods) >= 3 and _slope(moods) <= -0.35:
            signals.append({"signal": "mood_decline", "severity": "watch", "detail": f"Mood has dropped from {moods[0]} to {moods[-1]} out of 5 over {len(moods)} check-ins."})
        if len(sleeps) >= 3 and (_slope(sleeps) <= -0.4 or sleeps[-1] < 5.0):
            signals.append({"signal": "sleep_decline", "severity": "watch", "detail": f"Sleep fell from {sleeps[0]}h to {sleeps[-1]}h."})
        if len(pains) >= 3 and (_slope(pains) >= 0.4 or pains[-1] >= 7):
            signals.append({"signal": "pain_rising", "severity": "high" if pains[-1] >= 7 else "watch", "detail": f"Reported pain went from {pains[0]} to {pains[-1]} out of 10."})
    recent_missed = [m for m in adh["missed_doses"] if m["day"] >= (db.now().date() - timedelta(days=3)).isoformat()]
    if len(recent_missed) >= 2:
        meds = sorted({m["medication"] for m in recent_missed})
        signals.append({"signal": "missed_doses", "severity": "high" if len(recent_missed) >= 3 else "watch", "detail": f"{len(recent_missed)} missed doses in the last 3 days ({', '.join(meds)})."})
    today_overdue = [d for d in todays_doses(pid) if d["status"] == "overdue"]
    if today_overdue:
        signals.append({"signal": "overdue_today", "severity": "watch", "detail": "Overdue today: " + ", ".join(f"{d['medication']} ({d['slot']})" for d in today_overdue)})
    signals += _vital_signals(pid)
    # Compounding: several soft signals together is more worrying than any one alone.
    kinds = {s["signal"] for s in signals}
    if len(kinds & {"mood_decline", "sleep_decline", "missed_doses", "pain_rising", "low_oxygen", "oxygen_trending_down", "rapid_weight_gain", "weight_rising"}) >= 3:
        signals.append({"signal": "compound_decline", "severity": "high", "detail": "Several measures are slipping together, a pattern worth a check-in call."})
    top = max((SEVERITY_ORDER[s["severity"]] for s in signals), default=0)
    level = {v: k for k, v in SEVERITY_ORDER.items()}[top] if signals else "ok"
    return {"level": level, "signals": signals, "adherence_pct": adh["overall_pct"]}


# ---------------------------------------------------------------- alerts
def family_recipients(pid: str, severity: str) -> list[dict]:
    """Who hears about an alert: family by their notification preference, plus assigned clinicians for high/urgent."""
    p = db.one("SELECT family_id FROM patients WHERE id=?", (pid,))
    if not p:
        return []
    out = [u for u in db.rows("SELECT id, name, role, phone, notify_level FROM users WHERE family_id=? AND role IN ('admin','family') AND active=1", (p["family_id"],))
           if u["notify_level"] == "all" or SEVERITY_ORDER[severity] >= SEVERITY_ORDER["high"]]
    if SEVERITY_ORDER[severity] >= SEVERITY_ORDER["high"]:
        out += db.rows("SELECT u.id, u.name, u.role, u.phone, u.notify_level FROM users u JOIN clinician_patients cp ON cp.user_id=u.id WHERE cp.patient_id=? AND u.active=1", (pid,))
    return out


def raise_alert(pid: str, severity: str, title: str, detail: str) -> dict:
    severity = severity.lower()
    if severity not in SEVERITY_ORDER:
        return {"ok": False, "error": f"severity must be one of {list(SEVERITY_ORDER)}"}
    existing = db.rows("SELECT * FROM alerts WHERE patient_id=? AND status='open' AND title=? AND ts>=?", (pid, title, (db.real_now() - timedelta(hours=12)).isoformat()))
    if existing:
        return {"ok": True, "deduplicated": True, "alert": existing[0]}
    if UNVERIFIED_HELP_RE.search(detail):          # models sometimes invent "she has called 112": never present that as fact to the family
        detail = detail.rstrip() + " (Note: it is NOT confirmed that emergency services were called. Please check with them directly.)"
    escalated = False
    if SEVERITY_ORDER[severity] < SEVERITY_ORDER["urgent"] and EMERGENCY_RE.search(f"{title} {detail}"):
        severity, escalated = "urgent", True
    names = ", ".join(u["name"] for u in family_recipients(pid, severity))
    with db.conn() as c:
        cur = c.execute("INSERT INTO alerts (patient_id,ts,severity,title,detail,notified) VALUES (?,?,?,?,?,?)", (pid, db.real_now().isoformat(), severity, title, detail, names))
    out = {"ok": True, "alert": {"id": cur.lastrowid, "patient_id": pid, "severity": severity, "title": title, "detail": detail, "notified": names}}
    if escalated:
        out["escalated"] = True
    if SEVERITY_ORDER[severity] >= SEVERITY_ORDER["high"]:
        # Put the safety wording in the tool result itself: it is the last thing the model reads before it speaks.
        out["say_next"] = (
            "SAFETY: your very next sentence must tell the person to call 112 now (108 for an ambulance) if this is an emergency. "
            f"Then say you have told their family ({names or 'the family'}). Never say or imply that help is on the way or that you called anyone; "
            "you cannot. Do not mention 100."
            if severity == "urgent" else
            f"Tell the person you have let their family know ({names or 'the family'}) and encourage them to call their doctor today. "
            "Never say that help or a visit is on the way.")
    return out


def list_alerts(pid: str, status: str = "open") -> list[dict]:
    if status == "all":
        return db.rows("SELECT * FROM alerts WHERE patient_id=? ORDER BY ts DESC LIMIT 50", (pid,))
    return db.rows("SELECT * FROM alerts WHERE patient_id=? AND status=? ORDER BY ts DESC LIMIT 50", (pid, status))


def alert_patient(alert_id: int) -> str | None:
    r = db.one("SELECT patient_id FROM alerts WHERE id=?", (alert_id,))
    return r["patient_id"] if r else None


def resolve_alert(pid: str, alert_id: int, resolution: str = "") -> dict:
    """Resolves only an alert that belongs to `pid` (so a tool bound to one patient cannot touch another's alert)."""
    if alert_patient(alert_id) != pid:
        return {"ok": True, "id": alert_id, "resolution": resolution, "note": "No open alert with that id for this patient."}
    with db.conn() as c:
        c.execute("UPDATE alerts SET status='resolved' WHERE id=? AND patient_id=?", (alert_id, pid))
    return {"ok": True, "id": alert_id, "resolution": resolution}


# ---------------------------------------------------------------- memory (state across sessions)
def remember(pid: str, content: str, kind: str = "preference") -> dict:
    with db.conn() as c:
        c.execute("INSERT INTO memories (patient_id,ts,kind,content) VALUES (?,?,?,?)", (pid, db.real_now().isoformat(), kind, content))
    return {"ok": True, "remembered": content}


def recall(pid: str, limit: int = 20) -> list[dict]:
    return db.rows("SELECT kind, content, ts FROM memories WHERE patient_id=? ORDER BY id DESC LIMIT ?", (pid, limit))


# ---------------------------------------------------------------- composite views
def snapshot(pid: str) -> dict:
    p = patient_profile(pid)
    checks = recent_checkins(pid, 7)
    return {
        "now": db.now().isoformat(),
        "person": p,
        "caregivers": db.rows("SELECT id, name, role, phone, notify_level FROM users WHERE family_id=? AND role IN ('admin','family') AND active=1 ORDER BY role, name", (p["family_id"],)) if p else [],
        "clinicians": db.rows("SELECT u.id, u.name, u.blurb FROM users u JOIN clinician_patients cp ON cp.user_id=u.id WHERE cp.patient_id=? AND u.active=1", (pid,)),
        "doses_today": todays_doses(pid),
        "next_appointments": upcoming_appointments(pid, 3),
        "open_alerts": list_alerts(pid, "open"),
        "latest_checkin": checks[-1] if checks else None,
        "checkins_7d": checks,
        "vitals": recent_vitals(pid, 14),
        "adherence": adherence(pid, 7),
        "signals": evaluate_signals(pid),
        "memories": recall(pid, 5),
        "medications": medications(pid),
    }


def snapshot_for(actor, pid: str) -> dict:
    """The care snapshot minus whatever this account may not see (the patient does not get family alerts or family phone numbers)."""
    snap = snapshot(pid)
    if not actor.can("alert:read"):
        snap["open_alerts"] = []
    if not actor.can("family:read"):
        snap["caregivers"] = [{"id": c["id"], "name": c["name"], "role": c["role"]} for c in snap["caregivers"]]
    return snap


def patients_overview(actor) -> list[dict]:
    """Switcher data: each patient this account may see, with a one-glance risk level."""
    out = []
    for pid in actor.patients:
        p = patient_profile(pid)
        if not p:
            continue
        sig = evaluate_signals(pid)
        out.append({"id": pid, "name": p["name"], "age": p["age"], "conditions": p["conditions"], "language": p["language"], "level": sig["level"],
                    "open_alerts": len(list_alerts(pid, "open")) if actor.can("alert:read") else 0})
    return out
