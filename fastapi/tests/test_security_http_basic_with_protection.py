from hashlib import pbkdf2_hmac

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.security import HTTPBasicCredentials, HTTPBasicWithProtection
from fastapi.testclient import TestClient


def make_client(max_attempts: int = 2, window_seconds: int = 60):
    app = FastAPI()
    security = HTTPBasicWithProtection(
        max_attempts=max_attempts,
        window_seconds=window_seconds,
    )

    @app.get("/protected")
    def protected(
        request: Request,
        credentials: HTTPBasicCredentials = Depends(security),
    ):
        if credentials.username != "john" or not security.verify_password(
            credentials.password,
            pbkdf2_hmac(
                "sha256",
                b"secret",
                b"salt",
                1000,
            ).hex(),
            salt="salt",
            iterations=1000,
        ):
            security.record_failure(request)
            raise HTTPException(status_code=401, detail="Invalid credentials")
        security.reset_attempts(request)
        return {"username": credentials.username}

    return TestClient(app)


def test_failed_attempts_are_tracked_per_client_ip_until_lockout():
    client = make_client()

    response = client.get(
        "/protected",
        auth=("john", "wrong"),
        headers={"X-Forwarded-For": "198.51.100.1"},
    )
    assert response.status_code == 401

    response = client.get(
        "/protected",
        auth=("john", "wrong"),
        headers={"X-Forwarded-For": "198.51.100.1"},
    )
    assert response.status_code == 429
    assert response.headers["Retry-After"] == "60"


def test_failed_attempts_are_isolated_by_client_ip():
    client = make_client(max_attempts=1)

    locked = client.get(
        "/protected",
        auth=("john", "wrong"),
        headers={"X-Forwarded-For": "198.51.100.1"},
    )
    assert locked.status_code == 429

    allowed = client.get(
        "/protected",
        auth=("john", "secret"),
        headers={"X-Forwarded-For": "198.51.100.2"},
    )
    assert allowed.status_code == 200


def test_successful_authentication_resets_failed_attempts():
    client = make_client(max_attempts=2)
    headers = {"X-Forwarded-For": "198.51.100.10"}

    failed = client.get("/protected", auth=("john", "wrong"), headers=headers)
    assert failed.status_code == 401

    successful = client.get("/protected", auth=("john", "secret"), headers=headers)
    assert successful.status_code == 200

    failed_again = client.get("/protected", auth=("john", "wrong"), headers=headers)
    assert failed_again.status_code == 401


def test_password_verification_supports_pbkdf2_metadata_and_constant_time_compare(
    monkeypatch,
):
    calls: list[tuple[str, str]] = []

    def compare_digest(left: str, right: str) -> bool:
        calls.append((left, right))
        return left == right

    monkeypatch.setattr("fastapi.security.http.hmac.compare_digest", compare_digest)
    expected_hash = pbkdf2_hmac("sha256", b"secret", b"salt", 1000).hex()

    assert HTTPBasicWithProtection.verify_password(
        "secret",
        f"pbkdf2_sha256$1000$salt${expected_hash}",
    )
    assert not HTTPBasicWithProtection.verify_password(
        "wrong",
        f"pbkdf2_sha256$1000$salt${expected_hash}",
    )
    assert len(calls) == 2


def test_existing_http_basic_behavior_is_unchanged():
    client = make_client()

    response = client.get("/protected")

    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Basic"
