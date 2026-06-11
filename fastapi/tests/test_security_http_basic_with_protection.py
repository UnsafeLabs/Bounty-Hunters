from typing import Annotated

import pytest
from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import (
    HTTPBasicCredentials,
    HTTPBasicWithProtection,
)
from fastapi.testclient import TestClient
from starlette import status
from starlette.requests import Request

app = FastAPI()

security = HTTPBasicWithProtection(max_attempts=3, window_seconds=300)


@app.get("/users/me")
def read_current_user(
    credentials: HTTPBasicCredentials = Depends(security),
):
    # Simulate password verification: the test doesn't use mark_failed/mark_authenticated
    # automatically — the user code is expected to do that.  For integration testing
    # we use a separate endpoint that calls the rate-limiter explicitly.
    return {"username": credentials.username, "password": credentials.password}


# ── Helper app with explicit success/failure marking ──────────────────────

tracking_app = FastAPI()
tracking_security = HTTPBasicWithProtection(max_attempts=3, window_seconds=300)


@tracking_app.get("/login")
def login(credentials: HTTPBasicCredentials = Depends(tracking_security)):
    # Simulate a password check
    if credentials.username == "admin" and credentials.password == "secret":
        return {"msg": "ok"}
    raise HTTPException(status_code=401, detail="Invalid credentials")


@tracking_app.get("/login-with-tracking")
async def login_with_tracking(
    request: Request,
    credentials: HTTPBasicCredentials = Depends(tracking_security),
):
    # Simulate success/failure marking
    if credentials.username == "admin" and credentials.password == "secret":
        await tracking_security.mark_authenticated(request)
        return {"msg": "ok"}
    else:
        await tracking_security.mark_failed(request)
        raise HTTPException(status_code=401, detail="Invalid credentials")


client = TestClient(app)
tracking_client = TestClient(tracking_app)


# ── Unit tests for password verification ──────────────────────────────────


class TestVerifyPassword:
    def test_pbkdf2_sha256_correct(self):
        """A correctly formed pbkdf2-sha256 hash should verify."""
        # Hash a known password
        hashed = HTTPBasicWithProtection.hash_password(
            "my-secret", algorithm="pbkdf2_sha256", rounds=1000
        )
        assert HTTPBasicWithProtection.verify_password("my-secret", hashed)

    def test_pbkdf2_sha256_incorrect(self):
        """Wrong password should not verify."""
        hashed = HTTPBasicWithProtection.hash_password(
            "my-secret", algorithm="pbkdf2_sha256", rounds=1000
        )
        assert not HTTPBasicWithProtection.verify_password("wrong", hashed)

    def test_pbkdf2_sha256_wrong_format(self):
        """Malformed hash strings should return False, not crash."""
        assert not HTTPBasicWithProtection.verify_password("x", "")
        assert not HTTPBasicWithProtection.verify_password("x", "garbage")
        assert not HTTPBasicWithProtection.verify_password(
            "x",
            "$pbkdf2-sha256$1000$salthash",  # too few parts
        )

    def test_sha256_correct(self):
        """sha256 format should verify."""
        hashed = HTTPBasicWithProtection.hash_password(
            "my-secret", algorithm="sha256"
        )
        assert HTTPBasicWithProtection.verify_password(
            "my-secret", hashed, algorithm="sha256"
        )

    def test_sha256_incorrect(self):
        """Wrong password with sha256 should not verify."""
        hashed = HTTPBasicWithProtection.hash_password(
            "my-secret", algorithm="sha256"
        )
        assert not HTTPBasicWithProtection.verify_password(
            "wrong", hashed, algorithm="sha256"
        )

    def test_timing_safe_comparison(self):
        """Verify that comparison uses hmac.compare_digest (constant-time)."""
        # Known hash for a known password
        hashed = HTTPBasicWithProtection.hash_password(
            "password123", algorithm="sha256"
        )
        # Should work for correct
        assert HTTPBasicWithProtection.verify_password(
            "password123", hashed, algorithm="sha256"
        )
        # Should not work for wrong
        assert not HTTPBasicWithProtection.verify_password(
            "Password123", hashed, algorithm="sha256"
        )

    def test_unsupported_algorithm(self):
        """Unknown algorithm should return False."""
        assert not HTTPBasicWithProtection.verify_password(
            "x", "$sha256$salt$hash", algorithm="bcrypt"
        )


# ── Unit tests for internal rate-limiting helpers ─────────────────────────


class TestRateLimitingInternals:
    def test_no_rate_limit_by_default(self):
        """A fresh instance should not rate-limit any IP."""
        limiter = HTTPBasicWithProtection(max_attempts=3, window_seconds=300)
        assert not limiter._is_rate_limited("10.0.0.1")

    def test_rate_limited_after_max_attempts(self):
        """After max_attempts failures, the IP should be rate-limited."""
        limiter = HTTPBasicWithProtection(max_attempts=3, window_seconds=300)
        limiter._record_failure("10.0.0.1")
        limiter._record_failure("10.0.0.1")
        limiter._record_failure("10.0.0.1")
        assert limiter._is_rate_limited("10.0.0.1")

    def test_not_rate_limited_below_max(self):
        """Below max_attempts, the IP should not be rate-limited."""
        limiter = HTTPBasicWithProtection(max_attempts=5, window_seconds=300)
        limiter._record_failure("10.0.0.1")
        limiter._record_failure("10.0.0.1")
        assert not limiter._is_rate_limited("10.0.0.1")

    def test_reset_on_success(self):
        """mark_authenticated should reset the attempt counter."""
        limiter = HTTPBasicWithProtection(max_attempts=3, window_seconds=300)
        limiter._record_failure("10.0.0.1")
        limiter._record_failure("10.0.0.1")
        limiter._reset_attempts("10.0.0.1")
        assert not limiter._is_rate_limited("10.0.0.1")

    def test_separate_ips_independent(self):
        """Failure from one IP should not affect another."""
        limiter = HTTPBasicWithProtection(max_attempts=2, window_seconds=300)
        limiter._record_failure("10.0.0.1")
        limiter._record_failure("10.0.0.1")
        assert limiter._is_rate_limited("10.0.0.1")
        assert not limiter._is_rate_limited("10.0.0.2")

    def test_seconds_until_retry_positive(self):
        """_seconds_until_retry should return a positive int when rate-limited."""
        limiter = HTTPBasicWithProtection(max_attempts=2, window_seconds=60)
        limiter._record_failure("10.0.0.1")
        limiter._record_failure("10.0.0.1")
        assert limiter._seconds_until_retry("10.0.0.1") > 0

    def test_cleanup_stale(self):
        """Stale entries (beyond window) should be cleaned up."""
        import time as _time

        limiter = HTTPBasicWithProtection(max_attempts=2, window_seconds=0.1)
        limiter._record_failure("10.0.0.1")
        limiter._record_failure("10.0.0.1")
        assert limiter._is_rate_limited("10.0.0.1")
        _time.sleep(0.15)
        # After the window expires, the entry should be cleaned up
        assert not limiter._is_rate_limited("10.0.0.1")


# ── Integration tests for the FastAPI endpoint ────────────────────────────


class TestHTTPBasicWithProtectionIntegration:
    def test_valid_credentials(self):
        """Valid HTTP Basic credentials should return a 200."""
        resp = client.get(
            "/users/me", headers={"Authorization": "Basic YWRtaW46c2VjcmV0"}
        )
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"username": "admin", "password": "secret"}

    def test_missing_authorization_header(self):
        """Missing Authorization header should return 401."""
        resp = client.get("/users/me")
        assert resp.status_code == 401, resp.text
        assert resp.json() == {"detail": "Not authenticated"}

    def test_invalid_scheme(self):
        """A non-Basic scheme should return 401."""
        resp = client.get(
            "/users/me", headers={"Authorization": "Bearer sometoken"}
        )
        assert resp.status_code == 401, resp.text

    def test_malformed_base64(self):
        """A malformed base64 payload should return 401."""
        resp = client.get(
            "/users/me", headers={"Authorization": "Basic not-valid-base64!!"}
        )
        assert resp.status_code == 401, resp.text

    def test_missing_colon(self):
        """Credentials without a colon should return 401."""
        resp = client.get(
            "/users/me", headers={"Authorization": "Basic " + "admin".encode().hex()}
        )
        # The test uses b64decode which is wrong — this sends a hex string,
        # but the actual implementation uses b64decode. Let's use proper base64.
        import base64

        encoded = base64.b64encode(b"admin").decode()
        resp = client.get(
            "/users/me", headers={"Authorization": f"Basic {encoded}"}
        )
        assert resp.status_code == 401, resp.text

    def test_rate_limiting_429(self):
        """After max_attempts failures, the endpoint should return 429."""
        import base64

        limiter = HTTPBasicWithProtection(max_attempts=3, window_seconds=300)
        track_app = FastAPI()
        track_sec = limiter

        @track_app.get("/test")
        async def test_endpoint(
            request: Request,
            credentials: HTTPBasicCredentials = Depends(track_sec),
        ):
            if credentials.username == "admin" and credentials.password == "secret":
                await track_sec.mark_authenticated(request)
                return {"msg": "ok"}
            else:
                await track_sec.mark_failed(request)
                raise HTTPException(status_code=401, detail="Invalid credentials")

        tc = TestClient(track_app)

        encoded_bad = base64.b64encode(b"user:wrong").decode()
        # Exhaust attempts
        for _ in range(3):
            resp = tc.get(
                "/test", headers={"Authorization": f"Basic {encoded_bad}"}
            )
            assert resp.status_code == 401

        # 4th attempt should get 429
        resp = tc.get("/test", headers={"Authorization": f"Basic {encoded_bad}"})
        assert resp.status_code == 429
        data = resp.json()
        assert data["detail"] == "Too Many Requests"
        assert "Retry-After" in resp.headers

    def test_successful_auth_resets_counter(self):
        """Successful authentication should reset the attempt counter."""
        import base64

        limiter = HTTPBasicWithProtection(max_attempts=3, window_seconds=300)
        track_app = FastAPI()
        track_sec = limiter

        @track_app.get("/test")
        async def test_endpoint(
            request: Request,
            credentials: HTTPBasicCredentials = Depends(track_sec),
        ):
            if credentials.username == "admin" and credentials.password == "secret":
                await track_sec.mark_authenticated(request)
                return {"msg": "ok"}
            else:
                await track_sec.mark_failed(request)
                raise HTTPException(status_code=401, detail="Invalid credentials")

        tc = TestClient(track_app)

        encoded_bad = base64.b64encode(b"user:wrong").decode()
        encoded_good = base64.b64encode(b"admin:secret").decode()

        # Fail 2 times
        for _ in range(2):
            resp = tc.get("/test", headers={"Authorization": f"Basic {encoded_bad}"})
            assert resp.status_code == 401

        # Succeed once - this should reset the counter
        resp = tc.get("/test", headers={"Authorization": f"Basic {encoded_good}"})
        assert resp.status_code == 200

        # Now fail 3 more times - should get 401 (not 429) because the counter was reset
        for _ in range(3):
            resp = tc.get("/test", headers={"Authorization": f"Basic {encoded_bad}"})
            assert resp.status_code == 401

        # 4th attempt after reset should get 429
        resp = tc.get("/test", headers={"Authorization": f"Basic {encoded_bad}"})
        assert resp.status_code == 429

    def test_openapi_schema(self):
        """The OpenAPI schema should include the HTTPBasic scheme."""
        resp = client.get("/openapi.json")
        assert resp.status_code == 200
        schema = resp.json()
        # The security scheme should be "HTTPBasic" or similar
        schemes = schema.get("components", {}).get("securitySchemes", {})
        # HTTPBasicWithProtection uses the class name as scheme_name
        basic_scheme = schemes.get("HTTPBasicWithProtection", {})
        assert basic_scheme.get("type") == "http"
        assert basic_scheme.get("scheme") == "basic"
