"""Tests for fastapi.security.api_key_rate_limit module."""

from __future__ import annotations

import time
from unittest.mock import patch

import pytest
from fastapi import Depends, FastAPI
from fastapi.security.api_key_rate_limit import (
    APIKeyCookieWithRateLimit,
    APIKeyQueryWithRateLimit,
    APIKeyWithRateLimit,
    _SlidingWindowCounter,
)
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# _SlidingWindowCounter unit tests
# ---------------------------------------------------------------------------


class TestSlidingWindowCounter:
    def test_allows_up_to_max(self):
        limiter = _SlidingWindowCounter(max_requests=5, window_seconds=60)
        for _ in range(5):
            allowed, _ = limiter.is_allowed("key1")
            assert allowed is True

    def test_blocks_after_max(self):
        limiter = _SlidingWindowCounter(max_requests=3, window_seconds=60)
        for _ in range(3):
            limiter.is_allowed("key1")
        allowed, retry_after = limiter.is_allowed("key1")
        assert allowed is False
        assert retry_after > 0

    def test_independent_keys(self):
        limiter = _SlidingWindowCounter(max_requests=2, window_seconds=60)
        limiter.is_allowed("a")
        limiter.is_allowed("a")
        allowed, _ = limiter.is_allowed("a")
        assert allowed is False

        allowed, _ = limiter.is_allowed("b")
        assert allowed is True

    def test_reset(self):
        limiter = _SlidingWindowCounter(max_requests=1, window_seconds=60)
        limiter.is_allowed("key1")
        allowed, _ = limiter.is_allowed("key1")
        assert allowed is False

        limiter.reset("key1")
        allowed, _ = limiter.is_allowed("key1")
        assert allowed is True

    def test_window_expiry(self):
        """After the window passes, requests should be allowed again."""
        limiter = _SlidingWindowCounter(max_requests=1, window_seconds=0.1)
        limiter.is_allowed("key1")
        allowed, _ = limiter.is_allowed("key1")
        assert allowed is False

        time.sleep(0.15)
        allowed, _ = limiter.is_allowed("key1")
        assert allowed is True


# ---------------------------------------------------------------------------
# APIKeyWithRateLimit (header)
# ---------------------------------------------------------------------------


def _make_header_app(
    rate_limit: str = "3/minute",
    deprecated_keys: list[str] | None = None,
) -> FastAPI:
    app = FastAPI()
    scheme = APIKeyWithRateLimit(
        name="X-API-Key",
        rate_limit=rate_limit,
        deprecated_keys=deprecated_keys,
    )

    @app.get("/protected")
    async def protected(api_key: str = Depends(scheme)):
        warning = scheme.get_warning_header(api_key)
        resp: dict = {"api_key": api_key}
        if warning:
            resp["warning"] = warning.get("Warning")
        return resp

    return app


class TestAPIKeyWithRateLimit:
    def test_valid_key_accepted(self):
        client = TestClient(_make_header_app())
        resp = client.get("/protected", headers={"X-API-Key": "valid-key"})
        assert resp.status_code == 200
        assert resp.json()["api_key"] == "valid-key"

    def test_missing_key_returns_401(self):
        client = TestClient(_make_header_app())
        resp = client.get("/protected")
        assert resp.status_code == 401

    def test_rate_limit_enforced(self):
        client = TestClient(_make_header_app(rate_limit="2/minute"))
        headers = {"X-API-Key": "rate-test-key"}
        assert client.get("/protected", headers=headers).status_code == 200
        assert client.get("/protected", headers=headers).status_code == 200
        resp = client.get("/protected", headers=headers)
        assert resp.status_code == 429
        assert "Retry-After" in resp.headers

    def test_different_keys_independent_limits(self):
        client = TestClient(_make_header_app(rate_limit="1/minute"))
        assert client.get("/protected", headers={"X-API-Key": "a"}).status_code == 200
        assert client.get("/protected", headers={"X-API-Key": "b"}).status_code == 200
        assert client.get("/protected", headers={"X-API-Key": "a"}).status_code == 429

    def test_deprecated_key_returns_warning(self):
        client = TestClient(
            _make_header_app(deprecated_keys=["old-key"])
        )
        resp = client.get("/protected", headers={"X-API-Key": "old-key"})
        assert resp.status_code == 200
        assert "deprecated" in resp.json().get("warning", "").lower()

    def test_non_deprecated_key_no_warning(self):
        client = TestClient(
            _make_header_app(deprecated_keys=["old-key"])
        )
        resp = client.get("/protected", headers={"X-API-Key": "new-key"})
        assert resp.status_code == 200
        assert resp.json().get("warning") is None

    def test_retry_after_header_value(self):
        client = TestClient(_make_header_app(rate_limit="1/second"))
        headers = {"X-API-Key": "retry-test"}
        client.get("/protected", headers=headers)
        resp = client.get("/protected", headers=headers)
        assert resp.status_code == 429
        retry_after = int(resp.headers["Retry-After"])
        assert 0 < retry_after <= 1


# ---------------------------------------------------------------------------
# APIKeyQueryWithRateLimit
# ---------------------------------------------------------------------------


class TestAPIKeyQueryWithRateLimit:
    def test_valid_key(self):
        app = FastAPI()
        scheme = APIKeyQueryWithRateLimit(name="key", rate_limit="5/minute")

        @app.get("/q")
        async def q(api_key: str = Depends(scheme)):
            return {"key": api_key}

        client = TestClient(app)
        resp = client.get("/q", params={"key": "abc"})
        assert resp.status_code == 200

    def test_rate_limit(self):
        app = FastAPI()
        scheme = APIKeyQueryWithRateLimit(name="key", rate_limit="2/minute")

        @app.get("/q")
        async def q(api_key: str = Depends(scheme)):
            return {"key": api_key}

        client = TestClient(app)
        assert client.get("/q", params={"key": "x"}).status_code == 200
        assert client.get("/q", params={"key": "x"}).status_code == 200
        assert client.get("/q", params={"key": "x"}).status_code == 429


# ---------------------------------------------------------------------------
# APIKeyCookieWithRateLimit
# ---------------------------------------------------------------------------


class TestAPIKeyCookieWithRateLimit:
    def test_valid_key(self):
        app = FastAPI()
        scheme = APIKeyCookieWithRateLimit(name="session", rate_limit="5/minute")

        @app.get("/c")
        async def c(api_key: str = Depends(scheme)):
            return {"key": api_key}

        client = TestClient(app)
        resp = client.get("/c", cookies={"session": "tok123"})
        assert resp.status_code == 200

    def test_rate_limit(self):
        app = FastAPI()
        scheme = APIKeyCookieWithRateLimit(name="session", rate_limit="1/minute")

        @app.get("/c")
        async def c(api_key: str = Depends(scheme)):
            return {"key": api_key}

        client = TestClient(app)
        assert client.get("/c", cookies={"session": "tok"}).status_code == 200
        assert client.get("/c", cookies={"session": "tok"}).status_code == 429


# ---------------------------------------------------------------------------
# Invalid rate_limit format
# ---------------------------------------------------------------------------


class TestInvalidRateLimit:
    def test_bad_format_raises(self):
        with pytest.raises(ValueError, match="Invalid rate_limit"):
            APIKeyWithRateLimit(name="X-Key", rate_limit="fast")

    def test_zero_count_raises(self):
        with pytest.raises(ValueError, match="Invalid rate_limit"):
            APIKeyWithRateLimit(name="X-Key", rate_limit="0/minute")

    def test_unknown_period_raises(self):
        with pytest.raises(ValueError, match="Invalid rate_limit"):
            APIKeyWithRateLimit(name="X-Key", rate_limit="10/century")
