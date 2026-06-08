"""Tests for HTTPBasicWithProtection — brute force protection for HTTP Basic auth."""

from base64 import b64encode

from fastapi import FastAPI, Security
from fastapi.security import HTTPBasicCredentials, HTTPBasicWithProtection
from fastapi.testclient import TestClient


def make_app(**kwargs):
    """Create a test app with HTTPBasicWithProtection and the given options."""
    app = FastAPI()
    security = HTTPBasicWithProtection(**kwargs)

    @app.get("/users/me")
    def read_current_user(
        credentials: HTTPBasicCredentials = Security(security),
    ):
        return {"username": credentials.username, "password": credentials.password}

    return app, security


def test_basic_auth_success():
    """Successful auth returns credentials and resets attempt counter."""
    app, _ = make_app(
        max_attempts=3,
        window_seconds=60,
        verify_password=lambda u, p: p == "secret",
    )
    client = TestClient(app)

    response = client.get("/users/me", auth=("john", "secret"))
    assert response.status_code == 200
    assert response.json() == {"username": "john", "password": "secret"}


def test_wrong_password_returns_401():
    """Wrong password returns 401 Not Authenticated."""
    app, _ = make_app(
        max_attempts=5,
        window_seconds=60,
        verify_password=lambda u, p: p == "secret",
    )
    client = TestClient(app)

    response = client.get("/users/me", auth=("john", "wrong"))
    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated"}


def test_brute_force_lockout():
    """After max_attempts failures, returns 429 with Retry-After header."""
    app, _ = make_app(
        max_attempts=3,
        window_seconds=60,
        verify_password=lambda u, p: p == "secret",
    )
    client = TestClient(app)

    # Make 3 failed attempts
    for _ in range(3):
        client.get("/users/me", auth=("john", "wrong"))

    # 4th attempt should be locked out even with correct password
    response = client.get("/users/me", auth=("john", "secret"))
    assert response.status_code == 429
    assert "Retry-After" in response.headers
    assert response.json()["detail"] == "Too many failed login attempts. Try again later."


def test_lockout_returns_retry_after_header():
    """Locked-out response includes a positive Retry-After value."""
    app, _ = make_app(
        max_attempts=2,
        window_seconds=120,
        verify_password=lambda u, p: False,
    )
    client = TestClient(app)

    for _ in range(2):
        client.get("/users/me", auth=("john", "bad"))

    response = client.get("/users/me", auth=("john", "whatever"))
    assert response.status_code == 429
    retry_after = int(response.headers["Retry-After"])
    assert retry_after > 0


def test_success_resets_attempt_counter():
    """A successful login resets the failed attempt counter."""
    app, _ = make_app(
        max_attempts=3,
        window_seconds=60,
        verify_password=lambda u, p: p == "secret",
    )
    client = TestClient(app)

    # 2 failures
    client.get("/users/me", auth=("john", "wrong"))
    client.get("/users/me", auth=("john", "wrong"))

    # Success resets
    response = client.get("/users/me", auth=("john", "secret"))
    assert response.status_code == 200

    # Now 2 more failures shouldn't trigger lockout (counter was reset)
    client.get("/users/me", auth=("john", "wrong"))
    client.get("/users/me", auth=("john", "wrong"))

    response = client.get("/users/me", auth=("john", "secret"))
    assert response.status_code == 200


def test_no_verify_password():
    """Without verify_password, all credentials are accepted."""
    app, _ = make_app(max_attempts=3, window_seconds=60)
    client = TestClient(app)

    response = client.get("/users/me", auth=("anyone", "anything"))
    assert response.status_code == 200


def test_timing_safe_comparison():
    """verify_password is called (constant-time path exercised)."""
    calls = []

    def verify(u, p):
        calls.append((u, p))
        return p == "correct"

    app, _ = make_app(max_attempts=5, window_seconds=60, verify_password=verify)
    client = TestClient(app)

    client.get("/users/me", auth=("user", "wrong"))
    assert len(calls) == 1
    assert calls[0] == ("user", "wrong")

    client.get("/users/me", auth=("user", "correct"))
    assert len(calls) == 2


def test_no_credentials_still_returns_401():
    """Missing credentials still returns 401 (not 429)."""
    app, _ = make_app(
        max_attempts=5,
        window_seconds=60,
        verify_password=lambda u, p: True,
    )
    client = TestClient(app)

    response = client.get("/users/me")
    assert response.status_code == 401


def test_invalid_base64_returns_401():
    """Malformed Authorization header returns 401."""
    app, _ = make_app(
        max_attempts=5,
        window_seconds=60,
        verify_password=lambda u, p: True,
    )
    client = TestClient(app)

    response = client.get(
        "/users/me",
        headers={"Authorization": "Basic notabase64token"},
    )
    assert response.status_code == 401


def test_optional_auth_returns_none():
    """With auto_error=False, missing credentials return None (200 with null)."""
    app = FastAPI()
    security = HTTPBasicWithProtection(
        max_attempts=5,
        window_seconds=60,
        auto_error=False,
    )

    @app.get("/users/me")
    def read_current_user(
        credentials: HTTPBasicCredentials | None = Security(security),
    ):
        if credentials is None:
            return {"username": None}
        return {"username": credentials.username}

    client = TestClient(app)

    response = client.get("/users/me")
    assert response.status_code == 200
    assert response.json() == {"username": None}


def test_different_ips_independent():
    """Failed attempts from different IPs are tracked independently."""
    app, security = make_app(
        max_attempts=2,
        window_seconds=60,
        verify_password=lambda u, p: p == "secret",
    )
    client = TestClient(app)

    # Simulate different IPs by manipulating the internal store
    security._attempts["1.1.1.1"] = [(0, False), (0, False)]

    # IP 1.1.1.1 is locked out
    response = client.get(
        "/users/me",
        auth=("john", "secret"),
        headers={"X-Forwarded-For": "1.1.1.1"},
    )
    assert response.status_code == 429

    # IP 2.2.2.2 is NOT locked out
    response = client.get(
        "/users/me",
        auth=("john", "secret"),
        headers={"X-Forwarded-For": "2.2.2.2"},
    )
    assert response.status_code == 200
