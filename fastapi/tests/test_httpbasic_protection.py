"""Tests for HTTPBasicWithProtection brute force protection."""

import time

import pytest
from fastapi import Depends, FastAPI
from fastapi.security import HTTPBasicCredentials, HTTPBasicWithProtection
from fastapi.testclient import TestClient


@pytest.fixture
def protected_app():
    """Create a FastAPI app with HTTPBasicWithProtection."""
    app = FastAPI()

    _users = {"admin": "secret", "user": "pass123"}

    def _check(username: str, password: str) -> bool:
        return _users.get(username) == password

    security = HTTPBasicWithProtection(
        max_attempts=3,
        lockout_window=60,
        check_password=_check,
    )

    @app.get("/me")
    def current_user(credentials: HTTPBasicCredentials = Depends(security)):
        return {"username": credentials.username}

    return app


class TestHTTPBasicWithProtection:
    """Tests for brute force attack prevention."""

    @pytest.fixture(autouse=True)
    def _init(self, protected_app):
        self.app = protected_app
        self.client = TestClient(self.app)

    def test_successful_auth(self):
        """Valid credentials return 200."""
        resp = self.client.get(
            "/me", auth=("admin", "secret")
        )
        assert resp.status_code == 200
        assert resp.json()["username"] == "admin"

    def test_failed_auth_returns_401(self):
        """Invalid credentials return 401."""
        resp = self.client.get(
            "/me", auth=("admin", "wrongpass")
        )
        assert resp.status_code == 401

    def test_lockout_after_max_attempts(self):
        """After max_attempts failures, 429 is returned."""
        for i in range(3):
            resp = self.client.get(
                "/me", auth=("admin", "wrongpass")
            )
            assert resp.status_code == 401

        # 4th attempt should be locked out
        resp = self.client.get(
            "/me", auth=("admin", "wrongpass")
        )
        assert resp.status_code == 429

    def test_retry_after_header_on_lockout(self):
        """Lockout response includes Retry-After header."""
        for i in range(3):
            self.client.get("/me", auth=("admin", "wrongpass"))

        resp = self.client.get("/me", auth=("admin", "wrongpass"))
        assert resp.status_code == 429
        assert "Retry-After" in resp.headers

    def test_success_resets_counter(self):
        """Successful auth resets the failure counter."""
        for i in range(2):  # 2 failures
            self.client.get("/me", auth=("admin", "wrongpass"))

        # Successful auth resets
        resp = self.client.get("/me", auth=("admin", "secret"))
        assert resp.status_code == 200

        # One more failure should NOT lock out yet (counter was reset)
        resp = self.client.get("/me", auth=("admin", "wrongpass"))
        assert resp.status_code == 401

    def test_different_ips_not_affected(self):
        """Failure tracking is per-IP."""
        # Lock out one IP
        for i in range(3):
            self.client.get(
                "/me",
                auth=("admin", "wrongpass"),
                headers={"X-Forwarded-For": "10.0.0.1"},
            )

        # IP 10.0.0.1 should be locked out
        resp = self.client.get(
            "/me",
            auth=("admin", "wrongpass"),
            headers={"X-Forwarded-For": "10.0.0.1"},
        )
        assert resp.status_code == 429

        # Different IP should still be allowed
        resp = self.client.get(
            "/me",
            auth=("admin", "secret"),
            headers={"X-Forwarded-For": "10.0.0.2"},
        )
        assert resp.status_code == 200

    def test_verify_password_static(self):
        """verify_password uses timing-safe comparison."""
        # Hash the password
        password = "mypassword"
        import hashlib, hmac
        expected_hash = hashlib.sha256(password.encode()).hexdigest()

        assert HTTPBasicWithProtection.verify_password(password, expected_hash)
        assert not HTTPBasicWithProtection.verify_password("wrong", expected_hash)
        assert not HTTPBasicWithProtection.verify_password(password, "wronghash")

    def test_lockout_window_expires(self):
        """After lockout_window expires, requests are allowed again."""
        app = FastAPI()

        def _check(username: str, password: str) -> bool:
            return username == "admin" and password == "secret"

        security = HTTPBasicWithProtection(
            max_attempts=2,
            lockout_window=1,  # 1 second window
            check_password=_check,
        )

        @app.get("/me")
        def current_user(credentials: HTTPBasicCredentials = Depends(security)):
            return {"username": credentials.username}

        client = TestClient(app)

        # 2 failures — 3rd should lock
        for i in range(2):
            client.get("/me", auth=("admin", "wrongpass"))

        resp = client.get("/me", auth=("admin", "wrongpass"))
        assert resp.status_code == 429

        # Wait for lockout to expire
        time.sleep(1.1)

        # Should be allowed again
        resp = client.get("/me", auth=("admin", "secret"))
        assert resp.status_code == 200

    def test_no_password_checker(self):
        """Without check_password, all credentials are accepted."""
        security = HTTPBasicWithProtection()
        app = FastAPI()

        @app.get("/open")
        def open_endpoint(credentials: HTTPBasicCredentials = Depends(security)):
            return {"username": credentials.username}

        client = TestClient(app)
        resp = client.get("/open", auth=("anyone", "anything"))
        assert resp.status_code == 200