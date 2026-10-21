"""Passwords, sign-in, lockout and tokens."""
import json
import time

from conftest import bearer

from carecircle import auth, db, passwords


def test_passwords_are_salted_scrypt_hashes_never_plaintext():
    h1, h2 = passwords.hash_password("Asha_2026"), passwords.hash_password("Asha_2026")
    assert h1 != h2 and h1.startswith("scrypt$") and "Asha_2026" not in h1                  # unique salt each time
    assert passwords.verify_password("Asha_2026", h1) and not passwords.verify_password("asha_2026", h1)
    assert not passwords.verify_password("x", None) and not passwords.verify_password("x", "garbage")
    stored = db.one("SELECT password_hash FROM users WHERE id='asha'")["password_hash"]
    assert "Asha_2026" not in stored


def test_password_policy():
    assert passwords.policy_error("short") and passwords.policy_error("password") and passwords.policy_error("Asha_2026") is None


def test_login_with_the_demo_password_works_and_is_case_sensitive(anon):
    r = anon.post("/api/auth/login", json={"username": "asha", "password": "Asha_2026"})
    assert r.status_code == 200 and r.json()["user"]["role"] == "person" and r.json()["user"]["patients"] == ["asha"]
    assert anon.post("/api/auth/login", json={"username": "asha", "password": "asha_2026"}).status_code == 401
    assert anon.post("/api/auth/login", json={"username": "ASHA", "password": "Asha_2026"}).status_code == 200      # usernames are not case sensitive


def test_clinician_passwords_use_the_surname(anon):
    assert anon.post("/api/auth/login", json={"username": "drsen", "password": "Sen_2026"}).status_code == 200
    assert anon.post("/api/auth/login", json={"username": "drsen", "password": "Dr_2026"}).status_code == 401


def test_unknown_user_and_wrong_password_are_indistinguishable(anon):
    a = anon.post("/api/auth/login", json={"username": "asha", "password": "wrong-password"})
    b = anon.post("/api/auth/login", json={"username": "nobody", "password": "wrong-password"})
    assert a.status_code == b.status_code == 401 and a.json() == b.json()


def test_repeated_failures_lock_the_account_even_for_the_right_password(anon):
    for _ in range(auth.MAX_FAILS):
        assert anon.post("/api/auth/login", json={"username": "meera", "password": "nope-nope"}).status_code == 401
    locked = anon.post("/api/auth/login", json={"username": "meera", "password": "Meera_2026"})
    assert locked.status_code == 429 and "Too many" in locked.json()["detail"]
    assert anon.post("/api/auth/login", json={"username": "isha", "password": "Isha_2026"}).status_code == 200      # other accounts unaffected


def test_lockout_expires(anon, monkeypatch):
    monkeypatch.setattr(auth, "LOCK_SECONDS", 1)
    for _ in range(auth.MAX_FAILS):
        anon.post("/api/auth/login", json={"username": "priya", "password": "nope-nope"})
    assert anon.post("/api/auth/login", json={"username": "priya", "password": "Priya_2026"}).status_code == 429
    time.sleep(1.2)
    assert anon.post("/api/auth/login", json={"username": "priya", "password": "Priya_2026"}).status_code == 200


def test_failed_logins_are_audited_without_the_password(anon, as_user):
    anon.post("/api/auth/login", json={"username": "rohan", "password": "SuperSecret-guess"})
    row = db.rows("SELECT * FROM audit WHERE action='auth:login' AND outcome='denied' ORDER BY id DESC LIMIT 1")[0]
    assert row["target"] == "rohan" and "SuperSecret" not in json.dumps(row)


def test_a_signed_in_user_can_change_their_own_password(anon, as_user):
    c = as_user("anu")
    assert c.post("/api/auth/password", json={"current_password": "wrong", "new_password": "Brand-new-pass1"}).status_code == 401
    assert c.post("/api/auth/password", json={"current_password": "Anu_2026", "new_password": "short"}).status_code == 422
    assert c.post("/api/auth/password", json={"current_password": "Anu_2026", "new_password": "Brand-new-pass1"}).status_code == 200
    assert anon.post("/api/auth/login", json={"username": "anu", "password": "Anu_2026"}).status_code == 401
    assert anon.post("/api/auth/login", json={"username": "anu", "password": "Brand-new-pass1"}).status_code == 200
    with db.conn() as conn:
        conn.execute("UPDATE users SET password_hash=?, pw_changed=0 WHERE id='anu'", (passwords.hash_password("Anu_2026"),))


def test_demo_directory_lists_everyone_with_default_passwords_until_changed(anon):
    d = {a["id"]: a for a in anon.get("/api/auth/demo-accounts").json()}
    assert len(d) >= 28 and d["asha"]["password"] == "Asha_2026" and d["drdas"]["password"] == "Das_2026"
    assert d["rohan"]["family_name"] == "Deshmukh family" and d["drsen"]["family_name"] == "Clinicians"
    with db.conn() as c:
        c.execute("UPDATE users SET pw_changed=1 WHERE id='rohan'")
    assert {a["id"]: a for a in anon.get("/api/auth/demo-accounts").json()}["rohan"]["password"] is None      # never advertise a changed password
    with db.conn() as c:
        c.execute("UPDATE users SET pw_changed=0 WHERE id='rohan'")


def test_demo_directory_and_login_switch_off_with_the_flag(anon, monkeypatch):
    monkeypatch.setenv("CARECIRCLE_DEMO_AUTH", "0")
    assert anon.get("/api/auth/demo-accounts").status_code == 404                  # no password list in production mode
    assert anon.post("/api/auth/login", json={"username": "asha", "password": "Asha_2026"}).status_code == 200       # normal sign-in still works


# ------------------------------------------------------------------ tokens
def test_missing_bad_tampered_and_expired_tokens_are_rejected(anon):
    assert anon.get("/api/snapshot?patient_id=asha").status_code == 401
    assert anon.get("/api/snapshot?patient_id=asha", headers={"Authorization": "Bearer nonsense"}).status_code == 401
    tok = bearer("asha")["Authorization"].split()[1]
    payload, sig = tok.split(".")
    forged = auth._b64(json.dumps({"sub": "rohan", "exp": int(time.time()) + 999}).encode()) + "." + sig
    assert anon.get("/api/snapshot?patient_id=asha", headers={"Authorization": f"Bearer {forged}"}).status_code == 401
    old = auth.make_token("rohan", ttl=-5)
    assert anon.get("/api/snapshot?patient_id=asha", headers={"Authorization": f"Bearer {old}"}).status_code == 401


def test_roles_and_scope_come_from_the_database_not_the_token(anon):
    tok = auth.make_token("meera")
    h = {"Authorization": f"Bearer {tok}"}
    assert anon.get("/api/admin/overview", headers=h).status_code == 403            # member
    with db.conn() as c:
        c.execute("UPDATE users SET role='admin' WHERE id='meera'")
    try:
        assert anon.get("/api/admin/overview", headers=h).status_code == 200        # promoted: effective immediately
    finally:
        with db.conn() as c:
            c.execute("UPDATE users SET role='family' WHERE id='meera'")
    assert anon.get("/api/admin/overview", headers=h).status_code == 403            # and demoted again immediately


def test_a_deactivated_account_loses_access_at_once_even_with_a_valid_token(anon):
    h = bearer("isha")
    assert anon.get("/api/snapshot?patient_id=asha", headers=h).status_code == 200
    with db.conn() as c:
        c.execute("UPDATE users SET active=0 WHERE id='isha'")
    try:
        assert anon.get("/api/snapshot?patient_id=asha", headers=h).status_code == 401
        assert anon.post("/api/auth/login", json={"username": "isha", "password": "Isha_2026"}).status_code == 401
    finally:
        with db.conn() as c:
            c.execute("UPDATE users SET active=1 WHERE id='isha'")


def test_actor_scope_is_computed_per_role():
    assert auth.build_actor("asha").patients == ("asha",)
    assert auth.build_actor("rohan").patients == ("asha", "madhav")
    assert auth.build_actor("drmehta").patients == ("asha", "kamla")
    assert auth.build_actor("suresh").patients == ("lakshmi",)
    assert not auth.build_actor("asha").can_access("madhav") and not auth.build_actor("rohan").can_access("lakshmi")
    assert auth.build_actor("nobody") is None
