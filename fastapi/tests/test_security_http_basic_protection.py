import base64

from fastapi import FastAPI, Security
from fastapi.security import HTTPBasicCredentials, HTTPBasicWithProtection
from fastapi.testclient import TestClient


def basic_auth(username: str, password: str) -> dict[str, str]:
    token = base64.b64encode(f"{username}:{password}".encode()).decode()
    return {"Authorization": f"Basic {token}"}


def create_client(max_attempts: int = 2) -> TestClient:
    app = FastAPI()
    security = HTTPBasicWithProtection(
        password_hash=HTTPBasicWithProtection.hash_password("secret"),
        max_attempts=max_attempts,
        window_seconds=60,
    )

    @app.get("/users/me")
    def read_current_user(
        credentials: HTTPBasicCredentials = Security(security),
    ):
        return {"username": credentials.username}

    return TestClient(app)


def test_http_basic_with_protection_allows_valid_password():
    response = create_client().get("/users/me", headers=basic_auth("alice", "secret"))

    assert response.status_code == 200
    assert response.json() == {"username": "alice"}


def test_http_basic_with_protection_locks_after_max_failed_attempts():
    client = create_client(max_attempts=2)

    first = client.get("/users/me", headers=basic_auth("alice", "wrong"))
    second = client.get("/users/me", headers=basic_auth("alice", "wrong"))

    assert first.status_code == 401
    assert second.status_code == 429
    assert int(second.headers["retry-after"]) > 0


def test_http_basic_with_protection_success_resets_failed_attempts():
    client = create_client(max_attempts=2)

    assert client.get("/users/me", headers=basic_auth("alice", "wrong")).status_code == 401
    assert (
        client.get("/users/me", headers=basic_auth("alice", "secret")).status_code
        == 200
    )
    assert client.get("/users/me", headers=basic_auth("alice", "wrong")).status_code == 401


def test_http_basic_with_protection_verify_password_constant_time_hash():
    password_hash = HTTPBasicWithProtection.hash_password("secret")

    assert HTTPBasicWithProtection.verify_password("secret", password_hash)
    assert not HTTPBasicWithProtection.verify_password("wrong", password_hash)
