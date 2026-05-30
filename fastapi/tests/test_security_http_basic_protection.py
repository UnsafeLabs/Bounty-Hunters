import base64
from collections.abc import Callable

import fastapi.security.http as http_module
import pytest
from fastapi import FastAPI, Security
from fastapi.security import HTTPBasicCredentials, HTTPBasicWithProtection
from fastapi.testclient import TestClient


def basic_auth(username: str, password: str) -> dict[str, str]:
    token = base64.b64encode(f"{username}:{password}".encode()).decode()
    return {"Authorization": f"Basic {token}"}


def create_protected_app() -> tuple[FastAPI, HTTPBasicWithProtection, dict[str, float]]:
    password_hash = HTTPBasicWithProtection.hash_password(
        "secret", salt=b"static-salt", iterations=1
    )

    def verifier(credentials: HTTPBasicCredentials) -> bool:
        return (
            credentials.username == "alice"
            and HTTPBasicWithProtection.verify_password(
                credentials.password, password_hash
            )
        )

    security = HTTPBasicWithProtection(
        max_attempts=2,
        window_seconds=30,
        password_verifier=verifier,
    )
    clock = {"now": 100.0}
    security._now = lambda: clock["now"]  # type: ignore[method-assign]
    app = FastAPI()

    @app.get("/users/me")
    async def read_current_user(
        credentials: HTTPBasicCredentials = Security(security),
    ):
        return {"username": credentials.username}

    return app, security, clock


def test_failed_attempts_lock_out_client_ip():
    app, _, _ = create_protected_app()
    client = TestClient(app)

    response = client.get("/users/me", headers=basic_auth("alice", "wrong"))
    assert response.status_code == 401
    response = client.get("/users/me", headers=basic_auth("alice", "still-wrong"))
    assert response.status_code == 401

    response = client.get("/users/me", headers=basic_auth("alice", "secret"))
    assert response.status_code == 429
    assert response.json() == {"detail": "Too many authentication attempts"}
    assert response.headers["Retry-After"] == "30"


def test_successful_authentication_resets_attempt_counter():
    app, _, _ = create_protected_app()
    client = TestClient(app)

    response = client.get("/users/me", headers=basic_auth("alice", "wrong"))
    assert response.status_code == 401
    response = client.get("/users/me", headers=basic_auth("alice", "secret"))
    assert response.status_code == 200
    assert response.json() == {"username": "alice"}

    response = client.get("/users/me", headers=basic_auth("alice", "wrong"))
    assert response.status_code == 401
    response = client.get("/users/me", headers=basic_auth("alice", "wrong-again"))
    assert response.status_code == 401
    response = client.get("/users/me", headers=basic_auth("alice", "secret"))
    assert response.status_code == 429


def test_lockout_expires_after_window():
    app, _, clock = create_protected_app()
    client = TestClient(app)

    client.get("/users/me", headers=basic_auth("alice", "wrong"))
    client.get("/users/me", headers=basic_auth("alice", "wrong-again"))
    response = client.get("/users/me", headers=basic_auth("alice", "secret"))
    assert response.status_code == 429

    clock["now"] = 131.0
    response = client.get("/users/me", headers=basic_auth("alice", "secret"))
    assert response.status_code == 200
    assert response.json() == {"username": "alice"}


def test_failed_attempts_are_scoped_per_ip():
    app, _, _ = create_protected_app()
    client_a = TestClient(app, client=("10.0.0.1", 50000))
    client_b = TestClient(app, client=("10.0.0.2", 50000))

    client_a.get("/users/me", headers=basic_auth("alice", "wrong"))
    client_a.get("/users/me", headers=basic_auth("alice", "wrong-again"))
    response = client_a.get("/users/me", headers=basic_auth("alice", "secret"))
    assert response.status_code == 429

    response = client_b.get("/users/me", headers=basic_auth("alice", "secret"))
    assert response.status_code == 200
    assert response.json() == {"username": "alice"}


def test_without_verifier_behaves_like_http_basic():
    security = HTTPBasicWithProtection(auto_error=False)
    app = FastAPI()

    @app.get("/users/me")
    async def read_current_user(
        credentials: HTTPBasicCredentials | None = Security(security),
    ):
        if credentials is None:
            return {"anonymous": True}
        return {"username": credentials.username, "password": credentials.password}

    client = TestClient(app)
    response = client.get("/users/me")
    assert response.status_code == 200
    assert response.json() == {"anonymous": True}

    response = client.get("/users/me", headers=basic_auth("alice", "not-checked"))
    assert response.status_code == 200
    assert response.json() == {"username": "alice", "password": "not-checked"}


def test_verify_password_uses_constant_time_compare(
    monkeypatch: pytest.MonkeyPatch,
):
    calls: list[tuple[bytes, bytes]] = []
    original_compare_digest: Callable[[bytes, bytes], bool] = (
        http_module.secrets.compare_digest
    )

    def compare_digest_spy(actual: bytes, expected: bytes) -> bool:
        calls.append((actual, expected))
        return original_compare_digest(actual, expected)

    monkeypatch.setattr(http_module.secrets, "compare_digest", compare_digest_spy)
    password_hash = HTTPBasicWithProtection.hash_password(
        "secret", salt=b"static-salt", iterations=1
    )

    assert HTTPBasicWithProtection.verify_password("secret", password_hash)
    assert not HTTPBasicWithProtection.verify_password("wrong", password_hash)
    assert not HTTPBasicWithProtection.verify_password("secret", "invalid")
    assert len(calls) == 2
