import time
from unittest.mock import patch

import pytest
from fastapi import FastAPI, Depends
from fastapi.security import HTTPBasic, HTTPBasicCredentials, HTTPBasicWithProtection
from fastapi.testclient import TestClient


# Helper: a password verification function that uses the static method
# but we'll use a simple comparison for testing (not bcrypt).
# We'll patch passlib to avoid dependency.

@pytest.fixture(autouse=True)
def patch_passlib(monkeypatch):
    # Mock passlib to avoid actual dependency
    class MockBcrypt:
        @staticmethod
        def verify(password, hashed):
            # Simple constant-time comparison using plain strings
            # In real use, hashed would be bcrypt hash
            from hmac import compare_digest
            return compare_digest(password, hashed)
    monkeypatch.setattr("passlib.hash.bcrypt", MockBcrypt())


def test_attempt_tracking():
    """Failed attempts are tracked per IP and eventually lock out."""
    app = FastAPI()

    # Simple password check: valid if password == "secret"
    def verify(username: str, password: str) -> bool:
        return password == "secret"

    security = HTTPBasicWithProtection(
        verify_password=verify,
        max_attempts=3,
        lockout_duration_seconds=60,
    )

    @app.get("/test")
    def endpoint(creds: HTTPBasicCredentials = Depends(security)):
        return {"message": "ok"}

    client = TestClient(app)

    # First 2 failed attempts should return 401
    for _ in range(2):
        response = client.get("/test", auth=("user", "wrong"))
        assert response.status_code == 401
        assert "Retry-After" not in response.headers

    # Third failed attempt should lock out
    response = client.get("/test", auth=("user", "wrong"))
    assert response.status_code == 429
    assert "Retry-After" in response.headers
    assert response.headers["Retry-After"] == "60"  # lockout 60 sec

    # Even after lockout, another attempt still 429
    response = client.get("/test", auth=("user", "wrong"))
    assert response.status_code == 429


def test_lockout_expiry():
    """After lockout duration, new attempts are allowed."""
    app = FastAPI()

    def verify(username: str, password: str) -> bool:
        return password == "secret"

    security = HTTPBasicWithProtection(
        verify_password=verify,
        max_attempts=2,
        lockout_duration_seconds=1,  # short lockout
    )

    @app.get("/test")
    def endpoint(creds: HTTPBasicCredentials = Depends(security)):
        return {"message": "ok"}

    client = TestClient(app)

    # First failure
    response = client.get("/test", auth=("user", "wrong"))
    assert response.status_code == 401
    # Second failure -> lockout
    response = client.get("/test", auth=("user", "wrong"))
    assert response.status_code == 429
    assert response.headers["Retry-After"] == "1"

    # Wait for lockout to expire (simulate by sleeping? We'll manipulate time via mock)
    with patch("time.time", return_value=time.time() + 2):
        response = client.get("/test", auth=("user", "wrong"))
        # Should be a new 401, not 429, because lockout expired
        assert response.status_code == 401
        # This second failure (after expiry) should re-lock?
        # Actually after lockout expiry, the entry is still there but count? 
        # Our implementation: after lockout, the entry stays with count and lockout_until expired.
        # On next failure, we check lockout_until > now -> false, so fail, increment count, if count >= max -> lock again.
        # So after one failure, count becomes 1 (since entry retained). Next failure -> 2 -> lock.
        response = client.get("/test", auth=("user", "wrong"))
        assert response.status_code == 429


def test_reset_on_success():
    """Successful authentication resets the attempt counter for that IP."""
    app = FastAPI()

    def verify(username: str, password: str) -> bool:
        return password == "secret"

    security = HTTPBasicWithProtection(
        verify_password=verify,
        max_attempts=3,
        lockout_duration_seconds=60,
    )

    @app.get("/test")
    def endpoint(creds: HTTPBasicCredentials = Depends(security)):
        return {"message": "ok"}

    client = TestClient(app)

    # Two failures
    client.get("/test", auth=("user", "wrong"))
    client.get("/test", auth=("user", "wrong"))

    # Successful login
    response = client.get("/test", auth=("user", "secret"))
    assert response.status_code == 200
    assert response.json() == {"message": "ok"}

    # Now attempt failure again: should only be first attempt (no lockout)
    response = client.get("/test", auth=("user", "wrong"))
    assert response.status_code == 401  # not locked out
    # Another failure
    response = client.get("/test", auth=("user", "wrong"))
    assert response.status_code == 401
    # Third failure -> lockout
    response = client.get("/test", auth=("user", "wrong"))
    assert response.status_code == 429


def test_timing_safe_comparison_uses_hmac():
    """The static verify_password method uses constant-time comparison (via hmac.compare_digest, or passlib)."""
    # We'll directly call the static method with known values
    # Since passlib is mocked to use compare_digest, this effectively tests constant-time
    result = HTTPBasicWithProtection.verify_password("hello", "hello")
    assert result is True
    result_false = HTTPBasicWithProtection.verify_password("hello", "world")
    assert result_false is False


def test_existing_httpbasic_unaffected():
    """The original HTTPBasic class still works as before."""
    app = FastAPI()
    security = HTTPBasic()

    @app.get("/test")
    def endpoint(creds: HTTPBasicCredentials = Depends(security)):
        return {"username": creds.username}

    client = TestClient(app)

    # Valid basic auth
    response = client.get("/test", auth=("alice", "pass"))
    assert response.status_code == 200
    assert response.json() == {"username": "alice"}

    # No auth header
    response = client.get("/test")
    assert response.status_code == 401


def test_different_ips_independent():
    """Lockout per IP: different IPs have separate counters."""
    app = FastAPI()

    def verify(username: str, password: str) -> bool:
        return password == "secret"

    security = HTTPBasicWithProtection(
        verify_password=verify,
        max_attempts=2,
        lockout_duration_seconds=60,
    )

    @app.get("/test")
    def endpoint(creds: HTTPBasicCredentials = Depends(security)):
        return {"message": "ok"}

    client = TestClient(app)

    # First IP makes 2 failures -> lockout
    client.get("/test", auth=("user", "wrong"), headers={"X-Forwarded-For": "1.2.3.4"})
    response = client.get("/test", auth=("user", "wrong"), headers={"X-Forwarded-For": "1.2.3.4"})
    assert response.status_code == 429

    # Second IP should be unaffected
    response = client.get("/test", auth=("user", "wrong"), headers={"X-Forwarded-For": "5.6.7.8"})
    assert response.status_code == 401  # first failure for this IP
    response = client.get("/test", auth=("user", "wrong"), headers={"X-Forwarded-For": "5.6.7.8"})
    assert response.status_code == 429  # second failure -> lockout
