from base64 import b64encode

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


def test_http_basic_with_protection_locks_out_after_failed_attempts() -> None:
    password_hash = HTTPBasicWithProtection.hash_password("secret", salt="0" * 32)

    def verify(credentials: HTTPBasicCredentials) -> bool:
        return (
            credentials.username == "alice"
            and HTTPBasicWithProtection.verify_password(
                credentials.password, password_hash
            )
        )

    security = HTTPBasicWithProtection(
        max_attempts=2, window_seconds=30, verify_credentials=verify
    )
    client = TestClient(create_app(security))

    response = client.get("/users/me", headers=basic_auth("alice", "wrong"))
    assert response.status_code == 401

    response = client.get("/users/me", headers=basic_auth("alice", "wrong"))
    assert response.status_code == 429
    assert int(response.headers["retry-after"]) > 0


def test_http_basic_with_protection_resets_counter_on_success() -> None:
    password_hash = HTTPBasicWithProtection.hash_password("secret", salt="1" * 32)

    def verify(credentials: HTTPBasicCredentials) -> bool:
        return (
            credentials.username == "alice"
            and HTTPBasicWithProtection.verify_password(
                credentials.password, password_hash
            )
        )

    security = HTTPBasicWithProtection(
        max_attempts=2, window_seconds=30, verify_credentials=verify
    )
    client = TestClient(create_app(security))

    assert (
        client.get("/users/me", headers=basic_auth("alice", "bad")).status_code == 401
    )
    assert (
        client.get("/users/me", headers=basic_auth("alice", "secret")).status_code
        == 200
    )
    assert (
        client.get("/users/me", headers=basic_auth("alice", "bad")).status_code == 401
    )


def test_http_basic_with_protection_tracks_attempts_per_ip() -> None:
    password_hash = HTTPBasicWithProtection.hash_password("secret", salt="2" * 32)

    def verify(credentials: HTTPBasicCredentials) -> bool:
        return (
            credentials.username == "alice"
            and HTTPBasicWithProtection.verify_password(
                credentials.password, password_hash
            )
        )

    security = HTTPBasicWithProtection(
        max_attempts=1, window_seconds=30, verify_credentials=verify
    )
    app = create_app(security)

    locked_client = TestClient(app, client=("10.0.0.1", 50000))
    clean_client = TestClient(app, client=("10.0.0.2", 50000))

    assert (
        locked_client.get("/users/me", headers=basic_auth("alice", "bad")).status_code
        == 429
    )
    assert (
        clean_client.get("/users/me", headers=basic_auth("alice", "secret")).status_code
        == 200
    )


def test_http_basic_with_protection_without_verifier_preserves_basic_behavior() -> None:
    security = HTTPBasicWithProtection(max_attempts=1)
    client = TestClient(create_app(security))

    response = client.get("/users/me", headers=basic_auth("alice", "not-verified"))

    assert response.status_code == 200
    assert response.json() == {"username": "alice"}


def test_http_basic_with_protection_password_hash_verification() -> None:
    password_hash = HTTPBasicWithProtection.hash_password("secret", salt="3" * 32)

    assert HTTPBasicWithProtection.verify_password("secret", password_hash)
    assert not HTTPBasicWithProtection.verify_password("wrong", password_hash)
    assert not HTTPBasicWithProtection.verify_password("secret", "not-a-valid-hash")
