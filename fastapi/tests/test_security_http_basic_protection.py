from typing import Annotated

import pytest
from fastapi import FastAPI, Security
from fastapi.security import HTTPBasicWithProtection
from fastapi.security.http import HTTPBasicCredentials
from fastapi.testclient import TestClient
from starlette.testclient import TestClient as StarletteTestClient


class Clock:
    def __init__(self, now: float = 1000.0):
        self.now = now

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def create_client(
    security: HTTPBasicWithProtection,
    *,
    client_host: str = "198.51.100.1",
) -> TestClient:
    app = FastAPI()

    @app.get("/users/me")
    def read_current_user(
        credentials: Annotated[HTTPBasicCredentials, Security(security)],
    ):
        return {"username": credentials.username}

    return TestClient(app, client=(client_host, 50000))


def create_security(
    *,
    clock: Clock | None = None,
    max_attempts: int = 2,
) -> HTTPBasicWithProtection:
    password_hash = HTTPBasicWithProtection.hash_password(
        "wonderland",
        salt=b"fixed-test-salt",
        iterations=1,
    )
    return HTTPBasicWithProtection(
        max_attempts=max_attempts,
        window_seconds=60,
        password_hashes={"alice": password_hash},
        time_func=clock,
    )


def test_existing_test_client_works_with_basic_auth_unchanged():
    app = FastAPI()
    security = HTTPBasicWithProtection()

    @app.get("/users/me")
    def read_current_user(
        credentials: Annotated[HTTPBasicCredentials, Security(security)],
    ):
        return {"username": credentials.username, "password": credentials.password}

    client = StarletteTestClient(app)
    response = client.get("/users/me", auth=("john", "secret"))

    assert response.status_code == 200, response.text
    assert response.json() == {"username": "john", "password": "secret"}


def test_failed_attempts_lock_out_client_ip_with_retry_after():
    clock = Clock()
    security = create_security(clock=clock)
    client = create_client(security)

    assert client.get("/users/me", auth=("alice", "wrong")).status_code == 401
    assert client.get("/users/me", auth=("alice", "still-wrong")).status_code == 401
    response = client.get("/users/me", auth=("alice", "wonderland"))

    assert response.status_code == 429, response.text
    assert response.headers["Retry-After"] == "60"
    assert response.json() == {"detail": "Too many authentication attempts"}


def test_failed_attempt_tracking_is_per_ip():
    clock = Clock()
    security = create_security(clock=clock)
    first_client = create_client(security, client_host="198.51.100.10")
    second_client = create_client(security, client_host="198.51.100.11")

    first_client.get("/users/me", auth=("alice", "wrong"))
    first_client.get("/users/me", auth=("alice", "wrong"))

    locked = first_client.get("/users/me", auth=("alice", "wonderland"))
    allowed = second_client.get("/users/me", auth=("alice", "wonderland"))

    assert locked.status_code == 429, locked.text
    assert allowed.status_code == 200, allowed.text
    assert allowed.json() == {"username": "alice"}


def test_successful_authentication_resets_attempt_counter():
    clock = Clock()
    security = create_security(clock=clock)
    client = create_client(security)

    assert client.get("/users/me", auth=("alice", "wrong")).status_code == 401
    assert client.get("/users/me", auth=("alice", "wonderland")).status_code == 200
    assert client.get("/users/me", auth=("alice", "wrong")).status_code == 401
    assert client.get("/users/me", auth=("alice", "wonderland")).status_code == 200


def test_unknown_user_counts_as_failed_attempt():
    clock = Clock()
    security = create_security(clock=clock)
    client = create_client(security)

    assert client.get("/users/me", auth=("bob", "wonderland")).status_code == 401
    assert client.get("/users/me", auth=("alice", "wrong")).status_code == 401
    response = client.get("/users/me", auth=("alice", "wonderland"))

    assert response.status_code == 429, response.text


def test_lockout_expires_after_configured_window():
    clock = Clock()
    security = create_security(clock=clock)
    client = create_client(security)

    client.get("/users/me", auth=("alice", "wrong"))
    client.get("/users/me", auth=("alice", "wrong"))
    locked = client.get("/users/me", auth=("alice", "wonderland"))
    clock.advance(61)
    unlocked = client.get("/users/me", auth=("alice", "wonderland"))

    assert locked.status_code == 429, locked.text
    assert unlocked.status_code == 200, unlocked.text


def test_verify_password_uses_constant_time_comparison(monkeypatch):
    calls: list[tuple[str, str]] = []

    def compare_digest(left: str, right: str) -> bool:
        calls.append((left, right))
        return left == right

    monkeypatch.setattr("fastapi.security.http.hmac.compare_digest", compare_digest)
    password_hash = HTTPBasicWithProtection.hash_password(
        "wonderland",
        salt=b"fixed-test-salt",
        iterations=1,
    )

    assert HTTPBasicWithProtection.verify_password("wonderland", password_hash) is True
    assert HTTPBasicWithProtection.verify_password("wrong", password_hash) is False
    assert len(calls) == 2
    assert calls[0][0] == calls[0][1]
    assert calls[1][0] != calls[1][1]


def test_invalid_constructor_values_raise_errors():
    with pytest.raises(ValueError, match="max_attempts"):
        HTTPBasicWithProtection(max_attempts=0)
    with pytest.raises(ValueError, match="window_seconds"):
        HTTPBasicWithProtection(window_seconds=0)
