from base64 import b64encode

import pytest
from fastapi import FastAPI, Security
from fastapi.security import HTTPBasicCredentials, HTTPBasicWithProtection
from fastapi.testclient import TestClient


def basic_auth(username: str, password: str) -> dict[str, str]:
    token = b64encode(f"{username}:{password}".encode("ascii")).decode("ascii")
    return {"Authorization": f"Basic {token}"}


def create_app(security: HTTPBasicWithProtection) -> FastAPI:
    app = FastAPI()

    @app.get("/users/me")
    def read_current_user(
        credentials: HTTPBasicCredentials = Security(security),
    ) -> dict[str, str]:
        return {"username": credentials.username}

    return app


def password_verifier(
    username: str,
    password: str,
    *,
    salt: str = "0" * 32,
):
    password_hash = HTTPBasicWithProtection.hash_password(password, salt=salt)

    def verify(credentials: HTTPBasicCredentials) -> bool:
        return (
            credentials.username == username
            and HTTPBasicWithProtection.verify_password(
                credentials.password,
                password_hash,
            )
        )

    return verify


def test_http_basic_with_protection_locks_out_after_failed_attempts():
    security = HTTPBasicWithProtection(
        max_attempts=2,
        window_seconds=30,
        verify_credentials=password_verifier("alice", "secret"),
    )
    client = TestClient(create_app(security))

    response = client.get("/users/me", headers=basic_auth("alice", "wrong"))
    assert response.status_code == 401

    response = client.get("/users/me", headers=basic_auth("alice", "wrong"))
    assert response.status_code == 429
    assert int(response.headers["retry-after"]) > 0

    response = client.get("/users/me", headers=basic_auth("alice", "secret"))
    assert response.status_code == 429


def test_http_basic_with_protection_resets_counter_on_success():
    security = HTTPBasicWithProtection(
        max_attempts=2,
        window_seconds=30,
        verify_credentials=password_verifier("alice", "secret", salt="1" * 32),
    )
    client = TestClient(create_app(security))

    response = client.get("/users/me", headers=basic_auth("alice", "bad"))
    assert response.status_code == 401

    response = client.get("/users/me", headers=basic_auth("alice", "secret"))
    assert response.status_code == 200

    response = client.get("/users/me", headers=basic_auth("alice", "bad"))
    assert response.status_code == 401


def test_http_basic_with_protection_tracks_attempts_per_ip():
    security = HTTPBasicWithProtection(
        max_attempts=1,
        window_seconds=30,
        verify_credentials=password_verifier("alice", "secret", salt="2" * 32),
    )
    app = create_app(security)
    locked_client = TestClient(app, client=("10.0.0.1", 50000))
    clean_client = TestClient(app, client=("10.0.0.2", 50000))

    response = locked_client.get("/users/me", headers=basic_auth("alice", "bad"))
    assert response.status_code == 429

    response = clean_client.get("/users/me", headers=basic_auth("alice", "secret"))
    assert response.status_code == 200


def test_http_basic_with_protection_without_verifier_preserves_basic_behavior():
    security = HTTPBasicWithProtection(max_attempts=1)
    client = TestClient(create_app(security))

    response = client.get("/users/me", headers=basic_auth("alice", "not-verified"))

    assert response.status_code == 200
    assert response.json() == {"username": "alice"}


def test_http_basic_with_protection_password_hash_verification():
    password_hash = HTTPBasicWithProtection.hash_password("secret", salt="3" * 32)

    assert HTTPBasicWithProtection.verify_password("secret", password_hash)
    assert not HTTPBasicWithProtection.verify_password("wrong", password_hash)
    assert not HTTPBasicWithProtection.verify_password("secret", "not-a-valid-hash")


def test_http_basic_with_protection_rejects_invalid_configuration():
    with pytest.raises(ValueError):
        HTTPBasicWithProtection(max_attempts=0)
    with pytest.raises(ValueError):
        HTTPBasicWithProtection(window_seconds=0)
