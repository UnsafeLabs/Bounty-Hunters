from base64 import b64encode

from fastapi import FastAPI, Security
from fastapi.security import HTTPBasicCredentials, HTTPBasicWithProtection
from fastapi.testclient import TestClient


def get_basic_auth_header(username: str, password: str) -> dict[str, str]:
    payload = b64encode(f"{username}:{password}".encode("ascii")).decode("ascii")
    return {"Authorization": f"Basic {payload}"}


def get_client(
    security: HTTPBasicWithProtection,
    *,
    host: str = "testclient",
) -> TestClient:
    app = FastAPI()

    @app.get("/users/me")
    def read_current_user(
        credentials: HTTPBasicCredentials = Security(security),
    ):
        return {"username": credentials.username}

    return TestClient(app, client=(host, 50000))


def test_security_http_basic_with_protection_tracks_failed_attempts():
    password_hash = HTTPBasicWithProtection.hash_password("secret", salt="tests")
    security = HTTPBasicWithProtection(
        max_attempts=2,
        window_seconds=60,
        credentials_verifier=lambda credentials: credentials.username == "john"
        and HTTPBasicWithProtection.verify_password(
            credentials.password, password_hash
        ),
    )
    client = get_client(security)

    response = client.get(
        "/users/me", headers=get_basic_auth_header("john", "incorrect")
    )

    assert response.status_code == 401, response.text
    assert len(security._failed_attempts["testclient"]) == 1


def test_security_http_basic_with_protection_returns_429_during_lockout():
    security = HTTPBasicWithProtection(
        max_attempts=2,
        window_seconds=30,
        credentials_verifier=lambda credentials: credentials.password == "secret",
    )
    security._clock = iter([100.0, 100.0, 105.0, 105.0, 110.0]).__next__
    client = get_client(security)

    response = client.get("/users/me", headers=get_basic_auth_header("john", "bad"))
    assert response.status_code == 401, response.text
    response = client.get("/users/me", headers=get_basic_auth_header("john", "bad"))
    assert response.status_code == 429, response.text
    assert response.headers["Retry-After"] == "25"
    response = client.get("/users/me", headers=get_basic_auth_header("john", "secret"))

    assert response.status_code == 429, response.text
    assert response.headers["Retry-After"] == "20"
    assert response.json() == {"detail": "Too many authentication attempts"}


def test_security_http_basic_with_protection_unlocks_after_window():
    security = HTTPBasicWithProtection(
        max_attempts=2,
        window_seconds=30,
        credentials_verifier=lambda credentials: credentials.password == "secret",
    )
    security._clock = iter([100.0, 100.0, 105.0, 105.0, 131.0]).__next__
    client = get_client(security)

    response = client.get("/users/me", headers=get_basic_auth_header("john", "bad"))
    assert response.status_code == 401, response.text
    response = client.get("/users/me", headers=get_basic_auth_header("john", "bad"))
    assert response.status_code == 429, response.text
    response = client.get("/users/me", headers=get_basic_auth_header("john", "secret"))

    assert response.status_code == 200, response.text
    assert response.json() == {"username": "john"}


def test_security_http_basic_with_protection_resets_attempts_on_success():
    security = HTTPBasicWithProtection(
        max_attempts=2,
        window_seconds=60,
        credentials_verifier=lambda credentials: credentials.password == "secret",
    )
    client = get_client(security)

    response = client.get("/users/me", headers=get_basic_auth_header("john", "bad"))
    assert response.status_code == 401, response.text
    response = client.get("/users/me", headers=get_basic_auth_header("john", "secret"))
    assert response.status_code == 200, response.text
    assert response.json() == {"username": "john"}
    response = client.get("/users/me", headers=get_basic_auth_header("john", "bad"))

    assert response.status_code == 401, response.text


def test_security_http_basic_with_protection_tracks_attempts_per_ip():
    security = HTTPBasicWithProtection(
        max_attempts=1,
        window_seconds=60,
        credentials_verifier=lambda credentials: credentials.password == "secret",
    )
    client_one = get_client(security, host="10.0.0.1")
    client_two = get_client(security, host="10.0.0.2")

    response = client_one.get("/users/me", headers=get_basic_auth_header("john", "bad"))
    assert response.status_code == 429, response.text
    response = client_one.get(
        "/users/me", headers=get_basic_auth_header("john", "secret")
    )
    assert response.status_code == 429, response.text
    response = client_two.get(
        "/users/me", headers=get_basic_auth_header("john", "secret")
    )

    assert response.status_code == 200, response.text
    assert response.json() == {"username": "john"}


def test_security_http_basic_with_protection_uses_timing_safe_password_check(
    monkeypatch,
):
    compare_digest_calls: list[tuple[str | bytes, str | bytes]] = []

    def compare_digest(first: str | bytes, second: str | bytes) -> bool:
        compare_digest_calls.append((first, second))
        return True

    monkeypatch.setattr("fastapi.security.http.hmac.compare_digest", compare_digest)

    assert HTTPBasicWithProtection.verify_password("secret", "secret") is True
    assert compare_digest_calls == [(b"secret", b"secret")]


def test_security_http_basic_with_protection_verifies_hashlib_passwords():
    password_hash = HTTPBasicWithProtection.hash_password(
        "secret", salt="tests", iterations=10
    )

    assert HTTPBasicWithProtection.verify_password("secret", password_hash) is True
    assert HTTPBasicWithProtection.verify_password("wrong", password_hash) is False
