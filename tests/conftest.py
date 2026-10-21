import os
import tempfile
from pathlib import Path

# Must be set before carecircle is imported: isolate the DB, pin the care clock (noon: 08:00 doses are overdue, evenings upcoming),
# and make password hashing cheap so the suite stays fast (production uses scrypt N=2**14).
_tmp = Path(tempfile.mkdtemp(prefix="carecircle-test-"))
os.environ["CARECIRCLE_DB"] = str(_tmp / "test.db")
os.environ["CARECIRCLE_DEMO_TIME"] = "12:00"
os.environ["CARECIRCLE_SCRYPT_N"] = "1024"
os.environ.pop("CARECIRCLE_POLLY_ACCESS_KEY_ID", None)

import socket  # noqa: E402
import threading  # noqa: E402
import time  # noqa: E402

import httpx  # noqa: E402
import pytest  # noqa: E402
import uvicorn  # noqa: E402

from carecircle import auth, db  # noqa: E402

db.init()          # seeds the six families once for the whole session


@pytest.fixture(autouse=True)
def fresh_state():
    """Each test starts from the same demo data for the Deshmukh family (the default test family) and no login lockouts."""
    db.reset("decline", "deshmukh")
    auth.clear_lockouts()
    with db.conn() as c:                    # chat history persists by design; start each test from a clean slate
        c.execute("DELETE FROM messages")
        c.execute("DELETE FROM conversations")
    yield


def token_for(user_id: str) -> str:
    return auth.make_token(user_id)


def bearer(user_id: str) -> dict:
    return {"Authorization": f"Bearer {token_for(user_id)}"}


@pytest.fixture(scope="session")
def server():
    """One real server per test session (the MCP session manager can only run once per process)."""
    from carecircle.app import app
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    srv = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
    t = threading.Thread(target=srv.run, daemon=True)
    t.start()
    for _ in range(200):
        if srv.started:
            break
        time.sleep(0.05)
    else:
        raise RuntimeError("test server did not start")
    yield f"http://127.0.0.1:{port}"
    srv.should_exit = True
    t.join(timeout=5)


@pytest.fixture()
def as_user(server):
    """Factory: an HTTP client signed in as any user, e.g. as_user('rohan')."""
    clients = []

    def make(user_id: str | None = None):
        c = httpx.Client(base_url=server, timeout=20, headers=bearer(user_id) if user_id else {})
        clients.append(c)
        return c
    yield make
    for c in clients:
        c.close()


@pytest.fixture()
def anon(as_user):
    return as_user(None)


@pytest.fixture()
def client(as_user):
    """Rohan (Deshmukh family admin): the default for tests that are not about permissions."""
    return as_user("rohan")
