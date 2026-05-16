from base64 import b64encode

import fastapi.security.http as http_security
import pytest
from fastapi import FastAPI, Security
from fastapi.security import HTTPBasicCredentials, HTTPBasicWithProtection
from fastapi.testclient import TestClient


def basic_auth(username: str, password: str) -> dict[str, str]:
    token = b64encode(f"{username}:{password}".encode()).decode()
    return {"Authorization": f"Basic {token}"}


def build_client(
    *,
    max_attempts: int = 2,
    window_seconds: int = 60,
    client_addr: tuple[str, int] = ("testclient", 50000),
) -> TestClient:
    return TestClient(
        build_app(max_attempts=max_attempts, window_seconds=window_seconds),
        client=client_addr,
    )


def build_app(
    *,
    max_attempts: int = 2,
    window_seconds: int = 60,
) -> FastAPI:
    password_hash = HTTPBasicWithProtection.hash_password(
        "secret",
        salt=b"fixed-test-salt",
        iterations=1,
    )

    def validate(credentials: HTTPBasicCredentials) -> bool:
        return (
            credentials.username == "alice"
            and HTTPBasicWithProtection.verify_password(
                credentials.password,
                password_hash,
            )
        )

    security = HTTPBasicWithProtection(
        max_attempts=max_attempts,
        window_seconds=window_seconds,
        credentials_validator=validate,
    )
    app = FastAPI()

    @app.get("/users/me")
    def read_current_user(
        credentials: HTTPBasicCredentials = Security(security),
    ) -> dict[str, str]:
        return {"username": credentials.username}

    return app


def test_http_basic_with_protection_tracks_failures_and_locks_out() -> None:
    client = build_client(max_attempts=2, window_seconds=30)

    first = client.get("/users/me", headers=basic_auth("alice", "wrong"))
    second = client.get("/users/me", headers=basic_auth("alice", "wrong-again"))
    locked = client.get("/users/me", headers=basic_auth("alice", "secret"))

    assert first.status_code == 401
    assert second.status_code == 401
    assert locked.status_code == 429
    assert locked.json() == {"detail": "Too many authentication attempts"}
    assert locked.headers["retry-after"].isdigit()


def test_http_basic_with_protection_resets_failures_on_success() -> None:
    client = build_client(max_attempts=2, window_seconds=30)

    failed = client.get("/users/me", headers=basic_auth("alice", "wrong"))
    successful = client.get("/users/me", headers=basic_auth("alice", "secret"))
    failed_after_reset = client.get("/users/me", headers=basic_auth("alice", "wrong"))

    assert failed.status_code == 401
    assert successful.status_code == 200
    assert successful.json() == {"username": "alice"}
    assert failed_after_reset.status_code == 401


def test_http_basic_with_protection_tracks_failures_per_ip() -> None:
    app = build_app(max_attempts=1, window_seconds=30)
    locked_client = TestClient(app, client=("192.0.2.1", 50000))
    other_client = TestClient(app, client=("192.0.2.2", 50000))

    failed = locked_client.get("/users/me", headers=basic_auth("alice", "wrong"))
    locked = locked_client.get("/users/me", headers=basic_auth("alice", "secret"))
    other_success = other_client.get("/users/me", headers=basic_auth("alice", "secret"))

    assert failed.status_code == 401
    assert locked.status_code == 429
    assert other_success.status_code == 200


def test_http_basic_with_protection_expires_failure_window(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = 100.0
    monkeypatch.setattr(http_security.time, "monotonic", lambda: now)
    client = build_client(max_attempts=2, window_seconds=1)

    assert (
        client.get("/users/me", headers=basic_auth("alice", "wrong")).status_code == 401
    )
    assert (
        client.get("/users/me", headers=basic_auth("alice", "wrong")).status_code == 401
    )

    now = 101.1

    response = client.get("/users/me", headers=basic_auth("alice", "secret"))

    assert response.status_code == 200


def test_http_basic_with_protection_password_hash_verification() -> None:
    password_hash = HTTPBasicWithProtection.hash_password(
        "secret",
        salt=b"fixed-test-salt",
        iterations=1,
    )

    assert HTTPBasicWithProtection.verify_password("secret", password_hash)
    assert not HTTPBasicWithProtection.verify_password("wrong", password_hash)
    assert HTTPBasicWithProtection.verify_password("plain", "plain")
    assert not HTTPBasicWithProtection.verify_password("plain", "different")


def test_http_basic_with_protection_validates_constructor_bounds() -> None:
    with pytest.raises(ValueError, match="max_attempts"):
        HTTPBasicWithProtection(max_attempts=0)

    with pytest.raises(ValueError, match="window_seconds"):
        HTTPBasicWithProtection(window_seconds=0)
