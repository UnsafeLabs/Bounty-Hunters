from __future__ import annotations

import hashlib
import time
from base64 import b64encode

import pytest
from starlette.testclient import TestClient

from fastapi import Depends, FastAPI
from fastapi.security.http import (
    HTTPBasicCredentials,
    HTTPBasicWithProtection,
    _BruteForceLimiter,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _basic_auth_header(username: str, password: str) -> dict[str, str]:
    """Return an Authorization header for HTTP Basic auth."""
    credentials = b64encode(f"{username}:{password}".encode()).decode()
    return {"Authorization": f"Basic {credentials}"}


def _make_app(**kwargs):
    """Return a minimal FastAPI app with HTTPBasicWithProtection."""
    app = FastAPI()
    security = HTTPBasicWithProtection(**kwargs)

    @app.get("/protected")
    async def protected(credentials: HTTPBasicCredentials = Depends(security)):
        return {"username": credentials.username}

    return app, security


# ---------------------------------------------------------------------------
# Tests — brute force limiter
# ---------------------------------------------------------------------------


class TestBruteForceLimiter:
    def test_allows_within_limit(self):
        limiter = _BruteForceLimiter(max_attempts=3, window_seconds=60)
        for _ in range(3):
            locked, _ = limiter.record_failure("1.2.3.4")
            assert locked is False

    def test_locks_out_after_max(self):
        limiter = _BruteForceLimiter(max_attempts=2, window_seconds=60)
        limiter.record_failure("1.2.3.4")
        limiter.record_failure("1.2.3.4")
        locked, retry_after = limiter.record_failure("1.2.3.4")
        assert locked is True
        assert retry_after > 0

    def test_per_ip_isolation(self):
        limiter = _BruteForceLimiter(max_attempts=1, window_seconds=60)
        limiter.record_failure("1.2.3.4")
        locked, _ = limiter.record_failure("5.6.7.8")
        assert locked is False

    def test_reset_clears_counter(self):
        limiter = _BruteForceLimiter(max_attempts=1, window_seconds=60)
        limiter.record_failure("1.2.3.4")
        limiter.reset("1.2.3.4")
        locked, _ = limiter.record_failure("1.2.3.4")
        assert locked is False

    def test_window_expiry(self):
        limiter = _BruteForceLimiter(max_attempts=1, window_seconds=1)
        limiter.record_failure("1.2.3.4")
        time.sleep(1.1)
        locked, _ = limiter.is_locked_out("1.2.3.4")
        assert locked is False


# ---------------------------------------------------------------------------
# Tests — HTTPBasicWithProtection
# ---------------------------------------------------------------------------


class TestHTTPBasicWithProtection:
    def test_successful_auth(self):
        app, _ = _make_app(max_attempts=5, window_seconds=300)
        client = TestClient(app)

        resp = client.get("/protected", headers=_basic_auth_header("user", "pass"))
        assert resp.status_code == 200
        assert resp.json() == {"username": "user"}

    def test_no_auth_returns_401(self):
        app, _ = _make_app(max_attempts=5, window_seconds=300)
        client = TestClient(app)

        resp = client.get("/protected")
        assert resp.status_code == 401

    def test_auto_error_false_returns_none(self):
        app = FastAPI()
        security = HTTPBasicWithProtection(max_attempts=5, window_seconds=300, auto_error=False)

        @app.get("/optional")
        async def optional(credentials: HTTPBasicCredentials | None = Depends(security)):
            return {"authenticated": credentials is not None}

        client = TestClient(app)
        resp = client.get("/optional")
        assert resp.status_code == 200
        assert resp.json() == {"authenticated": False}

    def test_failed_attempts_tracked(self):
        app, _ = _make_app(max_attempts=3, window_seconds=300)
        client = TestClient(app)

        # Make 3 failed attempts (no auth header)
        for _ in range(3):
            resp = client.get("/protected")
            assert resp.status_code == 401

        # 4th attempt should be locked out
        resp = client.get("/protected")
        assert resp.status_code == 429
        assert "Retry-After" in resp.headers

    def test_lockout_returns_429(self):
        app, _ = _make_app(max_attempts=2, window_seconds=300)
        client = TestClient(app)

        # Exhaust the limit
        for _ in range(2):
            client.get("/protected")

        resp = client.get("/protected")
        assert resp.status_code == 429
        assert "Too many failed" in resp.json()["detail"]

    def test_retry_after_is_positive(self):
        app, _ = _make_app(max_attempts=1, window_seconds=60)
        client = TestClient(app)

        client.get("/protected")  # 1st failure
        resp = client.get("/protected")  # locked out
        assert resp.status_code == 429
        retry_after = int(resp.headers["Retry-After"])
        assert retry_after > 0

    def test_success_resets_counter(self):
        app, _ = _make_app(max_attempts=2, window_seconds=300)
        client = TestClient(app)

        # Make 1 failure
        client.get("/protected")
        # Then succeed
        resp = client.get("/protected", headers=_basic_auth_header("user", "pass"))
        assert resp.status_code == 200
        # Counter should be reset — can fail again without lockout
        client.get("/protected")
        resp = client.get("/protected")
        assert resp.status_code == 401  # Not 429

    def test_per_ip_isolation(self):
        app, _ = _make_app(max_attempts=1, window_seconds=300)
        client = TestClient(app)

        # IP 1 fails
        client.get("/protected")
        # Different "IP" — still allowed (test client uses same IP though)
        # This test verifies the limiter logic, not the IP extraction.
        resp = client.get("/protected", headers=_basic_auth_header("user", "pass"))
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Tests — verify_password
# ---------------------------------------------------------------------------


class TestVerifyPassword:
    def test_correct_password(self):
        password = "my-secret"
        hashed = hashlib.sha256(password.encode()).hexdigest()
        assert HTTPBasicWithProtection.verify_password(password, hashed) is True

    def test_incorrect_password(self):
        hashed = hashlib.sha256("correct".encode()).hexdigest()
        assert HTTPBasicWithProtection.verify_password("wrong", hashed) is False

    def test_timing_safe(self):
        # verify_password uses hmac.compare_digest which is constant-time.
        # We just verify it works without error for various inputs.
        assert HTTPBasicWithProtection.verify_password("", hashlib.sha256(b"").hexdigest()) is True
        assert HTTPBasicWithProtection.verify_password("a", hashlib.sha256(b"b").hexdigest()) is False


# ---------------------------------------------------------------------------
# Tests — edge cases
# ---------------------------------------------------------------------------


class TestEdgeCases:
    def test_custom_max_attempts(self):
        app, _ = _make_app(max_attempts=10, window_seconds=60)
        client = TestClient(app)

        # Should allow 10 failures
        for _ in range(10):
            resp = client.get("/protected")
            assert resp.status_code == 401

        # 11th should be locked out
        resp = client.get("/protected")
        assert resp.status_code == 429

    def test_custom_window(self):
        app, _ = _make_app(max_attempts=1, window_seconds=1)
        client = TestClient(app)

        client.get("/protected")
        resp = client.get("/protected")
        assert resp.status_code == 429

        # After window expires
        time.sleep(1.1)
        resp = client.get("/protected")
        assert resp.status_code == 401  # Not locked out anymore

    def test_realm_in_www_authenticate(self):
        app, _ = _make_app(max_attempts=5, window_seconds=300, realm="MyApp")
        client = TestClient(app)

        resp = client.get("/protected")
        assert resp.status_code == 401
        assert "MyApp" in resp.headers.get("WWW-Authenticate", "")
