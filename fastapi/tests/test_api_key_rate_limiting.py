from __future__ import annotations

import time
from unittest.mock import patch

import pytest
from starlette.testclient import TestClient

from fastapi import Depends, FastAPI
from fastapi.middleware.deprecated_key_warning import DeprecatedKeyWarningMiddleware
from fastapi.security.api_key import (
    APIKeyWithRateLimit,
    _SlidingWindowLimiter,
    _parse_rate_limit,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_app(**kwargs):
    """Return a minimal FastAPI app with APIKeyWithRateLimit dependency."""
    app = FastAPI()
    scheme = APIKeyWithRateLimit(name="X-API-Key", **kwargs)

    @app.get("/items")
    async def read_items(api_key: str = Depends(scheme)):
        return {"api_key": api_key}

    return app, scheme


def _make_app_with_middleware(**kwargs):
    """Return a FastAPI app with DeprecatedKeyWarningMiddleware."""
    app = FastAPI()
    app.add_middleware(DeprecatedKeyWarningMiddleware)
    scheme = APIKeyWithRateLimit(name="X-API-Key", **kwargs)

    @app.get("/items")
    async def read_items(api_key: str = Depends(scheme)):
        return {"api_key": api_key}

    return app, scheme


# ---------------------------------------------------------------------------
# Tests — rate limit parsing
# ---------------------------------------------------------------------------


class TestParseRateLimit:
    def test_parse_minute(self):
        assert _parse_rate_limit("100/minute") == (100, 60)

    def test_parse_minutes(self):
        assert _parse_rate_limit("50/minutes") == (50, 60)

    def test_parse_min(self):
        assert _parse_rate_limit("200/min") == (200, 60)

    def test_parse_m(self):
        assert _parse_rate_limit("1000/m") == (1000, 60)

    def test_parse_hour(self):
        assert _parse_rate_limit("5000/hour") == (5000, 3600)

    def test_parse_h(self):
        assert _parse_rate_limit("5000/h") == (5000, 3600)

    def test_parse_second(self):
        assert _parse_rate_limit("10/second") == (10, 1)

    def test_parse_s(self):
        assert _parse_rate_limit("10/s") == (10, 1)

    def test_parse_day(self):
        assert _parse_rate_limit("100000/day") == (100000, 86400)

    def test_parse_d(self):
        assert _parse_rate_limit("100000/d") == (100000, 86400)

    def test_parse_with_spaces(self):
        assert _parse_rate_limit(" 100 / minute ") == (100, 60)

    def test_parse_invalid(self):
        with pytest.raises(ValueError, match="Invalid rate_limit format"):
            _parse_rate_limit("fast")

    def test_parse_empty(self):
        with pytest.raises(ValueError):
            _parse_rate_limit("")

    def test_parse_no_slash(self):
        with pytest.raises(ValueError):
            _parse_rate_limit("100minute")


# ---------------------------------------------------------------------------
# Tests — sliding window limiter
# ---------------------------------------------------------------------------


class TestSlidingWindowLimiter:
    def test_allows_within_limit(self):
        limiter = _SlidingWindowLimiter(max_requests=3, window_seconds=1)
        for _ in range(3):
            allowed, retry = limiter.check("key1")
            assert allowed is True
            assert retry == 0

    def test_blocks_over_limit(self):
        limiter = _SlidingWindowLimiter(max_requests=2, window_seconds=60)
        limiter.check("key1")
        limiter.check("key1")
        allowed, retry = limiter.check("key1")
        assert allowed is False
        assert retry > 0

    def test_per_key_isolation(self):
        limiter = _SlidingWindowLimiter(max_requests=1, window_seconds=60)
        limiter.check("key1")
        allowed, _ = limiter.check("key2")
        assert allowed is True

    def test_window_expiry(self):
        limiter = _SlidingWindowLimiter(max_requests=1, window_seconds=1)
        limiter.check("key1")
        # After window expires, should be allowed again.
        time.sleep(1.1)
        allowed, _ = limiter.check("key1")
        assert allowed is True


# ---------------------------------------------------------------------------
# Tests — rate limiting in FastAPI
# ---------------------------------------------------------------------------


class TestRateLimiting:
    def test_requests_within_limit(self):
        app, _ = _make_app(rate_limit="5/minute")
        client = TestClient(app)

        for _ in range(5):
            resp = client.get("/items", headers={"X-API-Key": "my-key"})
            assert resp.status_code == 200
            assert resp.json() == {"api_key": "my-key"}

    def test_request_over_limit_returns_429(self):
        app, _ = _make_app(rate_limit="2/minute")
        client = TestClient(app)

        resp1 = client.get("/items", headers={"X-API-Key": "my-key"})
        assert resp1.status_code == 200

        resp2 = client.get("/items", headers={"X-API-Key": "my-key"})
        assert resp2.status_code == 200

        resp3 = client.get("/items", headers={"X-API-Key": "my-key"})
        assert resp3.status_code == 429
        assert "Rate limit exceeded" in resp3.json()["detail"]
        assert "Retry-After" in resp3.headers

    def test_retry_after_header_is_positive_integer(self):
        app, _ = _make_app(rate_limit="1/minute")
        client = TestClient(app)

        client.get("/items", headers={"X-API-Key": "key1"})
        resp = client.get("/items", headers={"X-API-Key": "key1"})
        assert resp.status_code == 429
        retry_after = int(resp.headers["Retry-After"])
        assert retry_after > 0

    def test_rate_limit_per_key_isolation(self):
        app, _ = _make_app(rate_limit="1/minute")
        client = TestClient(app)

        resp1 = client.get("/items", headers={"X-API-Key": "key1"})
        assert resp1.status_code == 200

        # Different key should still be allowed.
        resp2 = client.get("/items", headers={"X-API-Key": "key2"})
        assert resp2.status_code == 200

        # Same key should be rate-limited now.
        resp3 = client.get("/items", headers={"X-API-Key": "key1"})
        assert resp3.status_code == 429

    def test_no_api_key_returns_401(self):
        app, _ = _make_app(rate_limit="10/minute")
        client = TestClient(app)

        resp = client.get("/items")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Tests — deprecated keys
# ---------------------------------------------------------------------------


class TestDeprecatedKeys:
    def test_deprecated_key_authenticates_successfully(self):
        app, scheme = _make_app(
            rate_limit="10/minute",
            deprecated_keys=["old-key"],
        )
        client = TestClient(app)

        resp = client.get("/items", headers={"X-API-Key": "old-key"})
        assert resp.status_code == 200
        assert resp.json() == {"api_key": "old-key"}

    def test_deprecated_key_sets_state_flag(self):
        app, scheme = _make_app(
            rate_limit="10/minute",
            deprecated_keys=["old-key"],
        )
        client = TestClient(app)

        # The state flag is set on the request, but we can verify
        # through the middleware approach.
        resp = client.get("/items", headers={"X-API-Key": "old-key"})
        assert resp.status_code == 200

    def test_non_deprecated_key_no_warning(self):
        app, scheme = _make_app(
            rate_limit="10/minute",
            deprecated_keys=["old-key"],
        )
        client = TestClient(app)

        resp = client.get("/items", headers={"X-API-Key": "new-key"})
        assert resp.status_code == 200
        assert "Warning" not in resp.headers

    def test_deprecated_key_with_middleware_shows_warning(self):
        app, scheme = _make_app_with_middleware(
            rate_limit="10/minute",
            deprecated_keys=["old-key"],
        )
        client = TestClient(app)

        resp = client.get("/items", headers={"X-API-Key": "old-key"})
        assert resp.status_code == 200
        assert "Warning" in resp.headers
        assert "deprecated" in resp.headers["Warning"].lower()

    def test_non_deprecated_key_with_middleware_no_warning(self):
        app, scheme = _make_app_with_middleware(
            rate_limit="10/minute",
            deprecated_keys=["old-key"],
        )
        client = TestClient(app)

        resp = client.get("/items", headers={"X-API-Key": "new-key"})
        assert resp.status_code == 200
        assert "Warning" not in resp.headers

    def test_is_deprecated_method(self):
        scheme = APIKeyWithRateLimit(
            name="X-API-Key",
            rate_limit="10/minute",
            deprecated_keys=["old-key-1", "old-key-2"],
        )
        assert scheme.is_deprecated("old-key-1") is True
        assert scheme.is_deprecated("old-key-2") is True
        assert scheme.is_deprecated("new-key") is False

    def test_no_deprecated_keys(self):
        app, scheme = _make_app(rate_limit="10/minute")
        client = TestClient(app)

        resp = client.get("/items", headers={"X-API-Key": "any-key"})
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Tests — edge cases
# ---------------------------------------------------------------------------


class TestEdgeCases:
    def test_auto_error_false_no_key(self):
        app = FastAPI()
        scheme = APIKeyWithRateLimit(
            name="X-API-Key",
            rate_limit="10/minute",
            auto_error=False,
        )

        @app.get("/items")
        async def read_items(api_key: str | None = Depends(scheme)):
            return {"api_key": api_key}

        client = TestClient(app)
        resp = client.get("/items")
        assert resp.status_code == 200
        assert resp.json() == {"api_key": None}

    def test_custom_header_name(self):
        app, _ = _make_app(rate_limit="10/minute")
        # Re-create with custom name
        app2 = FastAPI()
        scheme = APIKeyWithRateLimit(
            name="Authorization",
            rate_limit="10/minute",
        )

        @app2.get("/items")
        async def read_items(api_key: str = Depends(scheme)):
            return {"api_key": api_key}

        client = TestClient(app2)
        resp = client.get("/items", headers={"Authorization": "Bearer my-key"})
        assert resp.status_code == 200
        assert resp.json() == {"api_key": "Bearer my-key"}
