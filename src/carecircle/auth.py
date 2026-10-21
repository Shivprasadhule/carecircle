"""Identity, passwords and role-based access control (RBAC) with family-level tenant isolation.

* Passwords are scrypt-hashed; repeated failures lock the account briefly.
* Tokens are HMAC-signed and carry only the user id and expiry. Role, family and patient access are re-read from the database on
  every request, so demoting or removing a person takes effect immediately.
* `PERMS` is the single permission matrix (REST API, MCP tools and UI all derive from it). On top of the role, every request is
  scoped to the patients the account may see (its own family's, or a clinician's assigned patients). One family can never reach another.
"""
from __future__ import annotations

import base64
import contextvars
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from dataclasses import dataclass

from . import db, passwords

ROLES = ("person", "family", "admin", "clinician")

_FAMILY = {
    "snapshot:read", "dose:log", "checkin:write", "vital:write", "appointment:write", "memory:read", "memory:write", "alert:raise", "alert:read",
    "alert:resolve", "agent:run", "chat:family", "conversation:read", "family:read",
}
PERMS: dict[str, frozenset[str]] = {
    # The person in care, on her/his own Echo: manages their own day, can tell the family. Sees only their own record.
    "person": frozenset({
        "snapshot:read", "dose:log", "checkin:write", "vital:write", "appointment:write", "memory:read", "memory:write", "alert:raise",
        "chat:person", "conversation:read_own", "conversation:delete_own",
    }),
    # Family member: full care-circle access for their own family's patients, no administration.
    "family": frozenset(_FAMILY),
    # Family admin: everything a member can do, plus managing people, medicines, instructions, facilities, the audit log.
    "admin": frozenset(_FAMILY | {
        "audit:read", "members:manage", "patients:manage", "meds:manage", "facilities:manage", "appointments:manage",
        "instructions:write", "demo:reset",
    }),
    # Clinician: read-only, for assigned patients only.
    "clinician": frozenset({"snapshot:read", "alert:read", "memory:read", "chat:family"}),
}

# Which permission each MCP tool needs. Enforced server-side on every call; the agent only gets tools its role may use.
TOOL_PERMS: dict[str, str] = {
    "get_care_snapshot": "snapshot:read",
    "list_todays_doses": "snapshot:read",
    "analyze_wellbeing_trends": "snapshot:read",
    "list_appointments": "snapshot:read",
    "log_dose": "dose:log",
    "record_checkin": "checkin:write",
    "record_vital": "vital:write",
    "schedule_appointment": "appointment:write",
    "raise_family_alert": "alert:raise",
    "list_alerts": "alert:read",
    "resolve_alert": "alert:resolve",
    "remember": "memory:write",
    "recall_memories": "memory:read",
}


@dataclass(frozen=True)
class Actor:
    id: str
    name: str
    role: str
    family_id: str | None = None
    patient_id: str | None = None                  # for role 'person': the patient they are
    patients: tuple[str, ...] = ()                 # every patient this account may see

    def can(self, perm: str) -> bool:
        return perm in PERMS.get(self.role, frozenset())

    def can_access(self, patient_id: str | None) -> bool:
        return bool(patient_id) and patient_id in self.patients

    def public(self) -> dict:
        return {"id": self.id, "name": self.name, "role": self.role, "family_id": self.family_id, "patient_id": self.patient_id,
                "permissions": sorted(PERMS.get(self.role, [])), "patients": list(self.patients)}


current_actor: contextvars.ContextVar[Actor | None] = contextvars.ContextVar("current_actor", default=None)
current_patient: contextvars.ContextVar[str | None] = contextvars.ContextVar("current_patient", default=None)


def demo_auth_enabled() -> bool:
    return os.environ.get("CARECIRCLE_DEMO_AUTH", "1") != "0"


# ------------------------------------------------------------------ tokens
def _secret() -> bytes:
    env = os.environ.get("CARECIRCLE_SECRET")
    if env:
        return env.encode()
    f = db.DB_PATH.parent / ".secret"
    db.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not f.exists():
        f.write_text(secrets.token_hex(32))
        f.chmod(0o600)
    return f.read_text().strip().encode()


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def make_token(actor: Actor | str, ttl: int = 8 * 3600) -> str:
    uid = actor if isinstance(actor, str) else actor.id
    payload = _b64(json.dumps({"sub": uid, "exp": int(time.time()) + ttl}).encode())
    return f"{payload}.{_b64(hmac.new(_secret(), payload.encode(), hashlib.sha256).digest())}"


def build_actor(user_id: str) -> Actor | None:
    """Load an ACTIVE account and work out which patients it may see. This is the only place access scope is computed."""
    u = db.one("SELECT * FROM users WHERE id=? AND active=1", (user_id,))
    if not u or u["role"] not in ROLES:
        return None
    if u["role"] == "person":
        own = db.one("SELECT id FROM patients WHERE id=? AND active=1", (u["patient_id"],))
        pats = (own["id"],) if own else ()
    elif u["role"] == "clinician":
        pats = tuple(r["id"] for r in db.rows(
            "SELECT p.id FROM patients p JOIN clinician_patients cp ON cp.patient_id=p.id WHERE cp.user_id=? AND p.active=1 ORDER BY p.name", (user_id,)))
    else:
        pats = tuple(r["id"] for r in db.rows("SELECT id FROM patients WHERE family_id=? AND active=1 ORDER BY name", (u["family_id"],)))
    return Actor(u["id"], u["name"], u["role"], u["family_id"], u["patient_id"], pats)


def verify_token(token: str | None) -> Actor | None:
    if not token or token.count(".") != 1:
        return None
    payload, sig = token.split(".")
    if not hmac.compare_digest(sig, _b64(hmac.new(_secret(), payload.encode(), hashlib.sha256).digest())):
        return None
    try:
        claims = json.loads(_unb64(payload))
    except Exception:  # noqa: BLE001
        return None
    if claims.get("exp", 0) < time.time():
        return None
    return build_actor(claims.get("sub", ""))


def bearer(header: str | None) -> str | None:
    if header and header.lower().startswith("bearer "):
        return header[7:].strip()
    return None


# ------------------------------------------------------------------ passwords + lockout
MAX_FAILS = int(os.environ.get("CARECIRCLE_MAX_LOGIN_FAILS", "5"))
LOCK_SECONDS = int(os.environ.get("CARECIRCLE_LOCK_SECONDS", "30"))
_fails: dict[str, list[float]] = {}
_lock = threading.Lock()


class LoginError(Exception):
    def __init__(self, kind: str):
        super().__init__(kind)
        self.kind = kind                                    # 'invalid' | 'locked'


def login(username: str, password: str) -> Actor:
    """Verify credentials. Unknown user and wrong password are indistinguishable (same error, same work)."""
    uid = (username or "").strip().lower()
    with _lock:
        recent = [t for t in _fails.get(uid, []) if t > time.time() - LOCK_SECONDS]
        _fails[uid] = recent
        if len(recent) >= MAX_FAILS:
            raise LoginError("locked")
    u = db.one("SELECT * FROM users WHERE id=? AND active=1", (uid,))
    ok = passwords.verify_password(password or "", u["password_hash"] if u else passwords.DUMMY_HASH)
    if not (u and ok):
        with _lock:
            _fails.setdefault(uid, []).append(time.time())
        raise LoginError("invalid")
    with _lock:
        _fails.pop(uid, None)
    actor = build_actor(uid)
    if actor is None:
        raise LoginError("invalid")
    return actor


def clear_lockouts() -> None:
    with _lock:
        _fails.clear()


def set_password(user_id: str, new_password: str) -> None:
    err = passwords.policy_error(new_password)
    if err:
        raise ValueError(err)
    with db.conn() as c:
        c.execute("UPDATE users SET password_hash=?, pw_changed=1 WHERE id=?", (passwords.hash_password(new_password), user_id))


def demo_accounts() -> list[dict]:
    """Sign-in page directory. Shows each account's demo password only while it is still the default."""
    from .seed_data import demo_password
    rows = db.rows(
        """SELECT u.id, u.name, u.role, u.blurb, u.family_id, u.pw_changed, f.name AS family_name
           FROM users u LEFT JOIN families f ON f.id=u.family_id WHERE u.active=1
           ORDER BY CASE WHEN u.family_id IS NULL THEN 1 ELSE 0 END, f.name,
                    CASE u.role WHEN 'admin' THEN 0 WHEN 'family' THEN 1 WHEN 'person' THEN 2 ELSE 3 END, u.name""")
    return [{"id": r["id"], "name": r["name"], "role": r["role"], "blurb": r["blurb"], "family_id": r["family_id"],
             "family_name": r["family_name"] or "Clinicians",
             "password": None if r["pw_changed"] else demo_password(r["name"])} for r in rows]
