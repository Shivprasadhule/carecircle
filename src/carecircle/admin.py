"""Family administration: people, patients, medicines, instructions, appointments and facilities.

Every operation is scoped to the acting admin's own family (a family id from another household is simply "not found"), validates
its input, and writes an audit entry that records WHAT changed (field names and, for medicines, the before/after values), never free text.
"""
from __future__ import annotations

import re
from typing import Any

from . import audit, auth, db, passwords
from .auth import Actor

USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9_.-]{2,29}$")
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
MEMBER_ROLES = ("family", "admin")
NOTIFY = ("all", "urgent")


class AdminError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def _text(v: Any, field: str, max_len: int = 200, required: bool = False) -> str | None:
    if v is None:
        if required:
            raise AdminError(422, f"{field} is required")
        return None
    v = str(v).strip()
    if required and not v:
        raise AdminError(422, f"{field} is required")
    if len(v) > max_len:
        raise AdminError(422, f"{field} must be at most {max_len} characters")
    return v


def _own_patient(actor: Actor, pid: str) -> dict:
    p = db.one("SELECT * FROM patients WHERE id=? AND family_id=?", (pid, actor.family_id))
    if not p:
        raise AdminError(404, "Not found")                       # same answer for "missing" and "someone else's"
    return p


def _own_user(actor: Actor, uid: str) -> dict:
    u = db.one("SELECT * FROM users WHERE id=? AND family_id=? AND role IN ('person','family','admin')", (uid, actor.family_id))
    if not u:
        raise AdminError(404, "Not found")
    return u


def _active_admins(family_id: str) -> int:
    return db.rows("SELECT COUNT(*) AS n FROM users WHERE family_id=? AND role='admin' AND active=1", (family_id,))[0]["n"]


def _need(actor: Actor, perm: str) -> None:
    if not actor.can(perm) or not actor.family_id:
        raise AdminError(403, f"A {actor.role} account is not allowed to do this ({perm})")


def _facility_ok(actor: Actor, facility_id: int | None) -> int | None:
    if facility_id in (None, "", 0):
        return None
    f = db.one("SELECT id FROM facilities WHERE id=? AND family_id=? AND active=1", (int(facility_id), actor.family_id))
    if not f:
        raise AdminError(422, "Unknown facility")
    return f["id"]


# ------------------------------------------------------------------ overview
def overview(actor: Actor) -> dict:
    if not actor.family_id:
        raise AdminError(403, "No family")
    fam = db.one("SELECT * FROM families WHERE id=?", (actor.family_id,))
    members = db.rows("SELECT id, name, role, patient_id, phone, notify_level, active, blurb FROM users WHERE family_id=? ORDER BY active DESC, role, name", (actor.family_id,))
    patients = db.rows("SELECT id, name, age, sex, conditions, allergies, language, facility_id, instructions, active FROM patients WHERE family_id=? ORDER BY active DESC, name", (actor.family_id,))
    for p in patients:
        p["medications"] = db.rows("SELECT * FROM medications WHERE patient_id=? ORDER BY active DESC, name", (p["id"],))
        p["appointments"] = db.rows("SELECT * FROM appointments WHERE patient_id=? AND status='scheduled' ORDER BY starts_at", (p["id"],))
        p["clinicians"] = db.rows("SELECT u.id, u.name, u.blurb FROM users u JOIN clinician_patients cp ON cp.user_id=u.id WHERE cp.patient_id=?", (p["id"],))
    facilities = db.rows("SELECT * FROM facilities WHERE family_id=? AND active=1 ORDER BY name", (actor.family_id,))
    return {"family": fam, "members": members, "patients": patients, "facilities": facilities}


# ------------------------------------------------------------------ people
def _new_username(username: str) -> str:
    u = (username or "").strip().lower()
    if not USERNAME_RE.match(u):
        raise AdminError(422, "Username must be 3-30 characters: letters, digits, dot, dash or underscore")
    if db.one("SELECT 1 FROM users WHERE id=?", (u,)):
        raise AdminError(409, "That username is taken")
    return u


def add_member(actor: Actor, name: str, username: str, role: str, phone: str | None, notify_level: str, password: str, patient_id: str | None = None) -> dict:
    _need(actor, "members:manage")
    name = _text(name, "name", 80, True)
    if role not in MEMBER_ROLES + ("person",):
        raise AdminError(422, "role must be family, admin or person")
    if notify_level not in NOTIFY:
        raise AdminError(422, "notify_level must be all or urgent")
    u = _new_username(username)
    err = passwords.policy_error(password or "")
    if err:
        raise AdminError(422, err)
    pid = None
    if role == "person":
        pid = _own_patient(actor, patient_id or "")["id"]
        if db.one("SELECT 1 FROM users WHERE patient_id=? AND role='person' AND active=1", (pid,)):
            raise AdminError(409, "That patient already has an account")
    with db.conn() as c:
        c.execute("INSERT INTO users (id,name,role,family_id,patient_id,password_hash,phone,notify_level,blurb,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                  (u, name, role, actor.family_id, pid, passwords.hash_password(password), _text(phone, "phone", 30), notify_level, f"Added by {actor.name}", db.real_now().isoformat()))
    audit.record(actor, "admin:add_member", f"{u} ({role})", args={"name": name, "role": role, "notify_level": notify_level})
    return {"id": u, "name": name, "role": role}


def update_member(actor: Actor, user_id: str, changes: dict) -> dict:
    _need(actor, "members:manage")
    u = _own_user(actor, user_id)
    sets: dict[str, Any] = {}
    if "name" in changes:
        sets["name"] = _text(changes["name"], "name", 80, True)
    if "phone" in changes:
        sets["phone"] = _text(changes["phone"], "phone", 30)
    if "notify_level" in changes:
        if changes["notify_level"] not in NOTIFY:
            raise AdminError(422, "notify_level must be all or urgent")
        sets["notify_level"] = changes["notify_level"]
    if "role" in changes and changes["role"] != u["role"]:
        if u["role"] == "person" or changes["role"] not in MEMBER_ROLES:
            raise AdminError(422, "Only family members can switch between family and admin")
        if u["role"] == "admin" and u["active"] and _active_admins(actor.family_id) <= 1:
            raise AdminError(409, "A family must keep at least one admin")
        sets["role"] = changes["role"]
    if "active" in changes:
        if not changes["active"] and u["role"] == "admin" and u["active"] and _active_admins(actor.family_id) <= 1:
            raise AdminError(409, "A family must keep at least one admin")
        sets["active"] = 1 if changes["active"] else 0
    pw = changes.get("new_password")
    if pw:
        err = passwords.policy_error(pw)
        if err:
            raise AdminError(422, err)
    if not sets and not pw:
        raise AdminError(422, "Nothing to change")
    with db.conn() as c:
        if sets:
            c.execute(f"UPDATE users SET {', '.join(k + '=?' for k in sets)} WHERE id=?", (*sets.values(), user_id))
        if pw:
            c.execute("UPDATE users SET password_hash=?, pw_changed=1 WHERE id=?", (passwords.hash_password(pw), user_id))
    audit.record(actor, "admin:update_member", user_id, args={"changed": sorted(sets) + (["password"] if pw else []),
                 **{k: [u[k], sets[k]] for k in ("role", "notify_level", "active") if k in sets}})
    return {"id": user_id, "changed": sorted(sets) + (["password"] if pw else [])}


def remove_member(actor: Actor, user_id: str) -> dict:
    u = _own_user(actor, user_id)
    if u["id"] == actor.id and _active_admins(actor.family_id) <= 1:
        raise AdminError(409, "A family must keep at least one admin")
    out = update_member(actor, user_id, {"active": False})
    audit.record(actor, "admin:remove_member", user_id)
    return out


# ------------------------------------------------------------------ patients
def _slug(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:24] or "patient"
    cand, i = base, 2
    while db.one("SELECT 1 FROM patients WHERE id=?", (cand,)):
        cand, i = f"{base}-{i}", i + 1
    return cand


PATIENT_FIELDS = {"name": 80, "conditions": 300, "allergies": 200, "language": 10, "sex": 1}


def add_patient(actor: Actor, data: dict) -> dict:
    _need(actor, "patients:manage")
    name = _text(data.get("name"), "name", 80, True)
    age = data.get("age")
    if not isinstance(age, int) or not 0 <= age <= 120:
        raise AdminError(422, "age must be a whole number between 0 and 120")
    pid = _slug(name)
    with db.conn() as c:
        c.execute("INSERT INTO patients (id,family_id,name,age,sex,conditions,allergies,language,facility_id,instructions) VALUES (?,?,?,?,?,?,?,?,?,?)",
                  (pid, actor.family_id, name, age, _text(data.get("sex"), "sex", 1) or "", _text(data.get("conditions"), "conditions", 300) or "",
                   _text(data.get("allergies"), "allergies", 200) or "", _text(data.get("language"), "language", 10) or "en-IN",
                   _facility_ok(actor, data.get("facility_id")), _text(data.get("instructions"), "instructions", 2000) or ""))
    audit.record(actor, "admin:add_patient", pid, args={"name": name}, patient_id=pid)
    return {"id": pid, "name": name}


def update_patient(actor: Actor, pid: str, changes: dict) -> dict:
    if not (actor.can("patients:manage") or actor.can("instructions:write")):      # permission first, then existence
        raise AdminError(403, f"A {actor.role} account is not allowed to do this (patients:manage)")
    p = _own_patient(actor, pid)
    sets: dict[str, Any] = {}
    core = {k for k in changes if k in PATIENT_FIELDS or k in ("age", "facility_id")}
    if core:
        _need(actor, "patients:manage")
    for k, mx in PATIENT_FIELDS.items():
        if k in changes:
            sets[k] = _text(changes[k], k, mx, k == "name")
    if "age" in changes:
        if not isinstance(changes["age"], int) or not 0 <= changes["age"] <= 120:
            raise AdminError(422, "age must be a whole number between 0 and 120")
        sets["age"] = changes["age"]
    if "facility_id" in changes:
        sets["facility_id"] = _facility_ok(actor, changes["facility_id"])
    if "instructions" in changes:
        _need(actor, "instructions:write")
        sets["instructions"] = _text(changes["instructions"], "instructions", 2000) or ""
    if not sets:
        raise AdminError(422, "Nothing to change")
    with db.conn() as c:
        c.execute(f"UPDATE patients SET {', '.join(k + '=?' for k in sets)} WHERE id=?", (*sets.values(), pid))
    audit.record(actor, "admin:update_patient", pid, args={"changed": sorted(sets), "instructions": "<changed>" if "instructions" in sets else None}, patient_id=pid)
    return {"id": pid, "changed": sorted(sets), "name": sets.get("name", p["name"])}


def archive_patient(actor: Actor, pid: str) -> dict:
    _need(actor, "patients:manage")
    _own_patient(actor, pid)
    with db.conn() as c:
        c.execute("UPDATE patients SET active=0 WHERE id=?", (pid,))
        c.execute("UPDATE users SET active=0 WHERE patient_id=? AND role='person'", (pid,))
    audit.record(actor, "admin:archive_patient", pid, patient_id=pid)
    return {"id": pid, "archived": True}


# ------------------------------------------------------------------ medicines
def _times(v: Any) -> str:
    parts = [t.strip() for t in (v.split(",") if isinstance(v, str) else list(v or []))]
    if not parts or len(parts) > 6 or any(not TIME_RE.match(t) for t in parts) or len(set(parts)) != len(parts):
        raise AdminError(422, "times must be 1-6 distinct HH:MM times, e.g. 08:00,20:00")
    return ",".join(sorted(parts))


def add_medication(actor: Actor, pid: str, data: dict) -> dict:
    _need(actor, "meds:manage")
    _own_patient(actor, pid)
    name = _text(data.get("name"), "name", 80, True)
    dose = _text(data.get("dose"), "dose", 60, True)
    if db.one("SELECT 1 FROM medications WHERE patient_id=? AND active=1 AND lower(name)=lower(?)", (pid, name)):
        raise AdminError(409, f"{name} is already on the list; edit it instead")
    with db.conn() as c:
        cur = c.execute("INSERT INTO medications (patient_id,name,dose,purpose,times,with_food,notes,prescriber,started_at) VALUES (?,?,?,?,?,?,?,?,?)",
                        (pid, name, dose, _text(data.get("purpose"), "purpose", 120), _times(data.get("times")), int(bool(data.get("with_food"))),
                         _text(data.get("notes"), "notes", 300), _text(data.get("prescriber"), "prescriber", 80), db.now().date().isoformat()))
    audit.record(actor, "admin:add_medication", f"{pid}:{name}", args={"dose": dose, "times": _times(data.get("times"))}, patient_id=pid)
    return {"id": cur.lastrowid, "name": name}


def _own_med(actor: Actor, med_id: int) -> dict:
    m = db.one("SELECT m.* FROM medications m JOIN patients p ON p.id=m.patient_id WHERE m.id=? AND p.family_id=?", (med_id, actor.family_id))
    if not m:
        raise AdminError(404, "Not found")
    return m


def update_medication(actor: Actor, med_id: int, changes: dict) -> dict:
    _need(actor, "meds:manage")
    m = _own_med(actor, med_id)
    sets: dict[str, Any] = {}
    for k, mx in (("name", 80), ("dose", 60), ("purpose", 120), ("notes", 300), ("prescriber", 80)):
        if k in changes:
            sets[k] = _text(changes[k], k, mx, k in ("name", "dose"))
    if "times" in changes:
        sets["times"] = _times(changes["times"])
    if "with_food" in changes:
        sets["with_food"] = int(bool(changes["with_food"]))
    if not sets:
        raise AdminError(422, "Nothing to change")
    with db.conn() as c:
        c.execute(f"UPDATE medications SET {', '.join(k + '=?' for k in sets)} WHERE id=?", (*sets.values(), med_id))
    # medicine changes matter clinically: record exactly what changed, old -> new
    audit.record(actor, "admin:update_medication", f"{m['patient_id']}:{m['name']}", args={"changes": {k: [m[k], v] for k, v in sets.items() if k != "notes"}}, patient_id=m["patient_id"])
    return {"id": med_id, "changed": sorted(sets)}


def stop_medication(actor: Actor, med_id: int, reason: str | None = None) -> dict:
    _need(actor, "meds:manage")
    m = _own_med(actor, med_id)
    with db.conn() as c:
        c.execute("UPDATE medications SET active=0, stopped_at=? WHERE id=?", (db.now().date().isoformat(), med_id))
    audit.record(actor, "admin:stop_medication", f"{m['patient_id']}:{m['name']}", args={"reason": "<redacted>" if reason else None}, patient_id=m["patient_id"])
    return {"id": med_id, "stopped": True}


# ------------------------------------------------------------------ appointments
def _own_appt(actor: Actor, appt_id: int) -> dict:
    a = db.one("SELECT a.* FROM appointments a JOIN patients p ON p.id=a.patient_id WHERE a.id=? AND p.family_id=?", (appt_id, actor.family_id))
    if not a:
        raise AdminError(404, "Not found")
    return a


def update_appointment(actor: Actor, appt_id: int, changes: dict) -> dict:
    _need(actor, "appointments:manage")
    a = _own_appt(actor, appt_id)
    sets: dict[str, Any] = {}
    for k, mx in (("title", 120), ("doctor", 80), ("location", 160), ("notes", 300)):
        if k in changes:
            sets[k] = _text(changes[k], k, mx, k == "title")
    if "starts_at" in changes:
        from datetime import datetime
        try:
            sets["starts_at"] = datetime.fromisoformat(changes["starts_at"]).isoformat()
        except (ValueError, TypeError):
            raise AdminError(422, "starts_at must be ISO-8601, e.g. 2026-10-28T10:30:00")
    if "needs_ride" in changes:
        sets["needs_ride"] = int(bool(changes["needs_ride"]))
    if "facility_id" in changes:
        sets["facility_id"] = _facility_ok(actor, changes["facility_id"])
    if not sets:
        raise AdminError(422, "Nothing to change")
    with db.conn() as c:
        c.execute(f"UPDATE appointments SET {', '.join(k + '=?' for k in sets)} WHERE id=?", (*sets.values(), appt_id))
    audit.record(actor, "admin:update_appointment", f"{a['patient_id']}:{a['title']}", args={"changed": sorted(sets)}, patient_id=a["patient_id"])
    return {"id": appt_id, "changed": sorted(sets)}


def cancel_appointment(actor: Actor, appt_id: int) -> dict:
    _need(actor, "appointments:manage")
    a = _own_appt(actor, appt_id)
    with db.conn() as c:
        c.execute("UPDATE appointments SET status='cancelled' WHERE id=?", (appt_id,))
    audit.record(actor, "admin:cancel_appointment", f"{a['patient_id']}:{a['title']}", patient_id=a["patient_id"])
    return {"id": appt_id, "cancelled": True}


# ------------------------------------------------------------------ facilities
FACILITY_KINDS = ("clinic", "hospital", "care home", "day care", "pharmacy", "lab", "home")


def add_facility(actor: Actor, data: dict) -> dict:
    _need(actor, "facilities:manage")
    kind = (data.get("kind") or "clinic").lower()
    if kind not in FACILITY_KINDS:
        raise AdminError(422, f"kind must be one of {', '.join(FACILITY_KINDS)}")
    name = _text(data.get("name"), "name", 100, True)
    with db.conn() as c:
        cur = c.execute("INSERT INTO facilities (family_id,name,kind,address,phone) VALUES (?,?,?,?,?)",
                        (actor.family_id, name, kind, _text(data.get("address"), "address", 200), _text(data.get("phone"), "phone", 30)))
    audit.record(actor, "admin:add_facility", name)
    return {"id": cur.lastrowid, "name": name}


def _own_facility(actor: Actor, fid: int) -> dict:
    f = db.one("SELECT * FROM facilities WHERE id=? AND family_id=? AND active=1", (fid, actor.family_id))
    if not f:
        raise AdminError(404, "Not found")
    return f


def update_facility(actor: Actor, fid: int, changes: dict) -> dict:
    _need(actor, "facilities:manage")
    _own_facility(actor, fid)
    sets: dict[str, Any] = {}
    for k, mx in (("name", 100), ("address", 200), ("phone", 30)):
        if k in changes:
            sets[k] = _text(changes[k], k, mx, k == "name")
    if "kind" in changes:
        if changes["kind"] not in FACILITY_KINDS:
            raise AdminError(422, f"kind must be one of {', '.join(FACILITY_KINDS)}")
        sets["kind"] = changes["kind"]
    if not sets:
        raise AdminError(422, "Nothing to change")
    with db.conn() as c:
        c.execute(f"UPDATE facilities SET {', '.join(k + '=?' for k in sets)} WHERE id=?", (*sets.values(), fid))
    audit.record(actor, "admin:update_facility", str(fid), args={"changed": sorted(sets)})
    return {"id": fid, "changed": sorted(sets)}


def remove_facility(actor: Actor, fid: int) -> dict:
    _need(actor, "facilities:manage")
    f = _own_facility(actor, fid)
    with db.conn() as c:
        c.execute("UPDATE facilities SET active=0 WHERE id=?", (fid,))
        c.execute("UPDATE patients SET facility_id=NULL WHERE facility_id=?", (fid,))
        c.execute("UPDATE appointments SET facility_id=NULL WHERE facility_id=?", (fid,))
    audit.record(actor, "admin:remove_facility", f["name"])
    return {"id": fid, "removed": True}


# ------------------------------------------------------------------ confirmed prescription rows -> medicines
def apply_prescription(actor: Actor, pid: str, payload: dict) -> dict:
    """Apply the rows a human reviewed. Each row goes through the SAME validation as adding/editing a medicine by hand; one bad row
    is reported and does not stop the others. Nothing here trusts the scan: the browser sends back only what the admin confirmed."""
    _need(actor, "meds:manage")
    _own_patient(actor, pid)
    items = payload.get("items")
    if not isinstance(items, list) or not items or len(items) > 20:
        raise AdminError(422, "Send between 1 and 20 reviewed rows")
    prescriber = _text(payload.get("prescriber"), "prescriber", 80)
    out: dict[str, Any] = {"added": [], "updated": [], "skipped": 0, "errors": []}
    for idx, it in enumerate(items):
        if not isinstance(it, dict):
            out["errors"].append({"index": idx, "name": None, "message": "Row is not valid"})
            continue
        action = it.get("action")
        if action == "skip":
            out["skipped"] += 1
            continue
        notes = " ".join(x for x in [_text(it.get("instructions"), "instructions", 200), _text(it.get("duration"), "duration", 40)] if x) or None
        body = {"name": it.get("name"), "dose": it.get("dose"), "purpose": it.get("purpose"), "times": it.get("times"), "with_food": it.get("with_food"),
                "notes": notes, "prescriber": it.get("prescriber") or prescriber}
        try:
            if action == "add":
                r = add_medication(actor, pid, body)
                out["added"].append(r["name"])
            elif action == "update":
                med = _own_med(actor, int(it.get("existing_id") or 0))
                if med["patient_id"] != pid:
                    raise AdminError(404, "Not found")
                changes = {k: body[k] for k in ("dose", "times", "with_food", "prescriber") if body.get(k) not in (None, "")}
                if notes:
                    changes["notes"] = notes
                update_medication(actor, med["id"], changes)
                out["updated"].append(med["name"])
            else:
                raise AdminError(422, "action must be add, update or skip")
        except AdminError as e:
            out["errors"].append({"index": idx, "name": it.get("name"), "message": e.message})
    appt = payload.get("appointment")
    if isinstance(appt, dict) and appt.get("starts_at"):
        from . import service
        r = service.schedule_appointment(pid, _text(appt.get("title"), "title", 120) or "Follow-up", appt["starts_at"], _text(appt.get("doctor"), "doctor", 80) or "",
                                         _text(appt.get("location"), "location", 160) or "", bool(appt.get("needs_ride")), _text(appt.get("notes"), "notes", 300) or "")
        if r.get("ok"):
            out["appointment"] = r["when"]
        else:
            out["errors"].append({"index": None, "name": "appointment", "message": r["error"]})
    audit.record(actor, "admin:apply_prescription", pid, args={"added": len(out["added"]), "updated": len(out["updated"]), "skipped": out["skipped"], "errors": len(out["errors"])}, patient_id=pid)
    return out
