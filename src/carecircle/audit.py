"""Append-only audit trail and conversation history (with retention), scoped by family.

The audit log records WHO did WHAT and the OUTCOME, including denied attempts. It deliberately does not copy chat content or
free-text health notes: it stores the action, a short target (e.g. the tool name and its non-sensitive arguments), and the result.
Nothing here updates or deletes audit rows. The only deletions in the app are chat-history retention and the patient's own
"delete my history", and the audit log records those too. A family admin sees only their own family's events.
"""
from __future__ import annotations

import json
import os
from datetime import timedelta

from . import db
from .auth import Actor

RETENTION_DAYS = int(os.environ.get("CARECIRCLE_RETENTION_DAYS", "30"))
_REDACT = {"note", "content", "message", "detail", "password", "new_password", "instructions"}   # free text / secrets: never copied here


def _safe(args: dict | None) -> str:
    if not args:
        return ""
    out = {k: ("<redacted>" if k in _REDACT else v) for k, v in args.items()}
    return json.dumps(out, ensure_ascii=False, default=str)[:400]


def _family_of(actor: Actor | None, patient_id: str | None) -> str | None:
    if actor and actor.family_id:
        return actor.family_id
    if patient_id:
        p = db.one("SELECT family_id FROM patients WHERE id=?", (patient_id,))
        return p["family_id"] if p else None
    return None


def record(actor: Actor | None, action: str, target: str = "", outcome: str = "allowed", args: dict | None = None, patient_id: str | None = None) -> None:
    with db.conn() as c:
        c.execute(
            "INSERT INTO audit (ts,actor_id,actor_role,family_id,patient_id,action,target,outcome,detail) VALUES (?,?,?,?,?,?,?,?,?)",
            (db.real_now().isoformat(), actor.id if actor else "anonymous", actor.role if actor else "none", _family_of(actor, patient_id), patient_id,
             action, target, outcome, _safe(args)),
        )


def recent(actor: Actor, limit: int = 100) -> list[dict]:
    """The family's own events (admins only call this). Platform-level events with no family (e.g. failed logins) are not shown."""
    limit = max(1, min(int(limit), 500))
    return db.rows("SELECT * FROM audit WHERE family_id=? ORDER BY id DESC LIMIT ?", (actor.family_id, limit))


# ---------------------------------------------------------------- conversations
def start_or_touch(conv_id: str, actor: Actor, role: str, language: str, patient_id: str | None) -> None:
    now = db.real_now().isoformat()
    with db.conn() as c:
        row = c.execute("SELECT user_id FROM conversations WHERE id=?", (conv_id,)).fetchone()
        if row and row["user_id"] != actor.id:
            raise PermissionError("This conversation belongs to someone else")
        if row:
            c.execute("UPDATE conversations SET updated_at=?, language=? WHERE id=?", (now, language, conv_id))
        else:
            c.execute("INSERT INTO conversations (id,user_id,patient_id,role,language,started_at,updated_at) VALUES (?,?,?,?,?,?,?)",
                      (conv_id, actor.id, patient_id, role, language, now, now))
    purge()


def add_message(conv_id: str, who: str, text: str, tools: list[str] | None = None) -> None:
    with db.conn() as c:
        c.execute("INSERT INTO messages (conv_id,ts,who,text,tools) VALUES (?,?,?,?,?)", (conv_id, db.real_now().isoformat(), who, text, json.dumps(tools or [])))


def _visible_clause(actor: Actor) -> tuple[str, tuple] | None:
    """Family and admins see conversations of people in THEIR family; the patient sees her own; clinicians see none."""
    if actor.can("conversation:read"):
        return "u.family_id = ?", (actor.family_id,)
    if actor.can("conversation:read_own"):
        return "c.user_id = ?", (actor.id,)
    return None


def list_conversations(actor: Actor, patient_id: str | None = None) -> list[dict]:
    v = _visible_clause(actor)
    if not v:
        return []
    where, args = v
    if patient_id:
        where, args = where + " AND c.patient_id = ?", args + (patient_id,)
    return db.rows(
        f"""SELECT c.id, c.user_id, u.name AS user_name, c.patient_id, c.role, c.language, c.started_at, c.updated_at,
                   (SELECT COUNT(*) FROM messages m WHERE m.conv_id=c.id) AS messages
            FROM conversations c JOIN users u ON u.id=c.user_id WHERE {where} ORDER BY c.updated_at DESC LIMIT 100""", args)


def get_conversation(conv_id: str, actor: Actor) -> list[dict] | None:
    v = _visible_clause(actor)
    if not v:
        return None
    where, args = v
    ok = db.one(f"SELECT c.id FROM conversations c JOIN users u ON u.id=c.user_id WHERE c.id=? AND {where}", (conv_id,) + args)
    if not ok:
        return None
    return db.rows("SELECT ts, who, text, tools FROM messages WHERE conv_id=? ORDER BY id", (conv_id,))


def delete_own(actor: Actor) -> int:
    with db.conn() as c:
        ids = [r["id"] for r in c.execute("SELECT id FROM conversations WHERE user_id=?", (actor.id,)).fetchall()]
        for i in ids:
            c.execute("DELETE FROM messages WHERE conv_id=?", (i,))
        c.execute("DELETE FROM conversations WHERE user_id=?", (actor.id,))
    record(actor, "conversation:delete_own", f"{len(ids)} conversations")
    return len(ids)


def purge(days: int | None = None) -> int:
    """Retention: drop messages (and empty conversations) older than N days."""
    cutoff = (db.real_now() - timedelta(days=days if days is not None else RETENTION_DAYS)).isoformat()
    with db.conn() as c:
        n = c.execute("DELETE FROM messages WHERE ts<?", (cutoff,)).rowcount
        c.execute("DELETE FROM conversations WHERE updated_at<? AND id NOT IN (SELECT DISTINCT conv_id FROM messages)", (cutoff,))
    return n
