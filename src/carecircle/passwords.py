"""Password hashing with scrypt (stdlib). Stored as  scrypt$N$r$p$salt$hash  so parameters can change without breaking old hashes."""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets

N = int(os.environ.get("CARECIRCLE_SCRYPT_N", 2**14))
R, P = 8, 1


def _derive(password: str, salt: bytes, n: int, r: int, p: int) -> bytes:
    return hashlib.scrypt(password.encode(), salt=salt, n=n, r=r, p=p, maxmem=64 * 1024 * 1024, dklen=32)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    h = _derive(password, salt, N, R, P)
    return "scrypt$%d$%d$%d$%s$%s" % (N, R, P, base64.b64encode(salt).decode(), base64.b64encode(h).decode())


def verify_password(password: str, stored: str | None) -> bool:
    """Constant-time check. Always does the same work, even for unknown users (pass a dummy hash), to avoid revealing who exists."""
    try:
        _, n, r, p, salt, h = (stored or "").split("$")
        return hmac.compare_digest(_derive(password, base64.b64decode(salt), int(n), int(r), int(p)), base64.b64decode(h))
    except Exception:  # noqa: BLE001 - malformed or missing hash
        return False


def policy_error(password: str) -> str | None:
    if len(password) < 8:
        return "Password must be at least 8 characters"
    if password.lower() in {"password", "12345678", "password1"}:
        return "That password is too common"
    return None


DUMMY_HASH = hash_password("not-a-real-password")
