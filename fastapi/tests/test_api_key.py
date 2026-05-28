"""Tests for api_key.py - APIKeyWithRateLimit rate limiting and deprecated keys."""

import time
from unittest.mock import MagicMock, patch

import pytest
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.testclient import TestClient

from fastapi import Depends, FastAPI
from fastapi.security.api_key import (
    APIKeyWithRateLimit,
    _parse_rate_limit,
    check_rate_limit,
    _rate_limit_store,
)


def setup_module():
    """Clear rate limit store before tests."""
    _rate_limit_store.clear()


def teardown_module():
    """Clear rate limit store after tests."""
    _rate_limit_store.clear()


class TestParseRateLimit:
    """Tests for rate limit string parsing."""

    def test_parse_per_minute(self):
        """Parse '100/minute' correctly."""
        max_req, window = _parse_rate_limit("100/minute")
        assert max_req == 100
        assert window == 60

    def test_parse_per_minute_short(self):
        """Parse '100/min' correctly."""
        max_req, window = _parse_rate_limit("100/min")
        assert max_req == 100
        assert window == 60

    def test_parse_per_second(self):
        """Parse '10/second' correctly."""
        max_req, window = _parse_rate_limit("10/second")
        assert max_req == 10
        assert window == 1

    def test_parse_per_hour(self):
        """Parse '1000/hour' correctly."""
        max_req, window = _parse_rate_limit("1000/hour")
        assert max_req == 1000
        assert window == 3600

    def test_parse_per_day(self):
        """Parse '5000/day' correctly."""
        max_req, window = _parse_rate_limit("5000/day")
        assert max_req == 5000
        assert window == 86400

    def test_invalid_format_raises(self):
        """Invalid format raises ValueError."""
        with pytest.raises(ValueError, match="Invalid rate limit format"):
            _parse_rate_limit("invalid")

    def test_invalid_format_no_slash(self):
        """Format without slash raises ValueError."""
        with pytest.raises(ValueError):
            _parse_rate_limit("100minute")


class TestCheckRateLimit:
    """Tests for the rate limit checking function."""

    def test_first_request_allowed(self):
        """First request should be allowed."""
        result = check_rate_limit("test-key", 10, 60)
        assert result.allowed is True
        assert result.remaining == 9

    def test_exceeds_limit(self):
        """Request exceeding limit should be denied."""
        for i in range(5):
            check_rate_limit("limited-key", 5, 60)

        result = check_rate_limit("limited-key", 5, 60)
        assert result.allowed is False
        assert result.remaining == 0
        assert result.retry_after is not None
        assert result.retry_after > 0

    def test_remaining_decrements(self):
        """Remaining count should decrement."""
        for i in range(3):
            result = check_rate_limit("decrement-key", 10, 60)
            assert result.remaining == 10 - (i + 1)

    def test_window_expires(self):
        """Expired timestamps should be cleaned."""
        # This test uses a 1-second window
        check_rate_limit("expire-key", 2, 1)
        check_rate_limit("expire-key", 2, 1)

        # Should be at limit
        result = check_rate_limit("expire-key", 2, 1)
        assert result.allowed is False

        # Wait for window to expire
        time.sleep(1.1)

        # Should be allowed again
        result = check_rate_limit("expire-key", 2, 1)
        assert result.allowed is True

    def test_different_keys_independent(self):
        """Different keys should have independent limits."""
        check_rate_limit("key-a", 2, 60)
        check_rate_limit("key-a", 2, 60)

        # key-a is at limit
        result_a = check_rate_limit("key-a", 2, 60)
        assert result_a.allowed is False

        # key-b should still be allowed
        result_b = check_rate_limit("key-b", 2, 60)
        assert result_b.allowed is True


class TestAPIKeyWithRateLimit:
    """Tests for APIKeyWithRateLimit class."""

    def test_successful_auth(self):
        """Valid API key should authenticate successfully."""
        app = FastAPI()
        auth = APIKeyWithRateLimit(name="X-API-Key", rate_limit="100/minute")

        @app.get("/test")
        async def test_endpoint(api_key: str = Depends(auth)):
            return {"key": api_key}

        client = TestClient(app)
        response = client.get("/test", headers={"X-API-Key": "valid-key-123"})

        assert response.status_code == 200
        assert response.json()["key"] == "valid-key-123"

    def test_rate_limit_exceeded(self):
        """Rate limit exceeded should return 429."""
        app = FastAPI()
        auth = APIKeyWithRateLimit(name="X-API-Key", rate_limit="2/minute")

        @app.get("/test")
        async def test_endpoint(api_key: str = Depends(auth)):
            return {"key": api_key}

        client = TestClient(app)

        # First two requests succeed
        response1 = client.get("/test", headers={"X-API-Key": "rate-test-key"})
        response2 = client.get("/test", headers={"X-API-Key": "rate-test-key"})
        assert response1.status_code == 200
        assert response2.status_code == 200

        # Third request should be rate limited
        response3 = client.get("/test", headers={"X-API-Key": "rate-test-key"})
        assert response3.status_code == 429
        assert "Retry-After" in response3.headers

    def test_rate_limit_headers(self):
        """Rate limit response should include limit headers."""
        app = FastAPI()
        auth = APIKeyWithRateLimit(name="X-API-Key", rate_limit="5/minute")

        @app.get("/test")
        async def test_endpoint(api_key: str = Depends(auth)):
            return {"key": api_key}

        client = TestClient(app)
        response = client.get("/test", headers={"X-API-Key": "headers-test"})

        assert "X-RateLimit-Limit" in response.headers
        assert response.headers["X-RateLimit-Limit"] == "5"
        assert "X-RateLimit-Remaining" in response.headers
        assert "X-RateLimit-Reset" in response.headers

    def test_deprecated_key_warning(self):
        """Deprecated key should include Warning header."""
        app = FastAPI()
        auth = APIKeyWithRateLimit(
            name="X-API-Key",
            rate_limit="100/minute",
            deprecated_keys=["old-key-123"],
        )

        @app.get("/test")
        async def test_endpoint(api_key: str = Depends(auth)):
            return {"key": api_key}

        client = TestClient(app)
        response = client.get("/test", headers={"X-API-Key": "old-key-123"})

        assert response.status_code == 200
        assert "Warning" in response.headers
        assert "old-key-123" in response.headers["Warning"]

    def test_valid_key_no_warning(self):
        """Valid (non-deprecated) key should not include Warning header."""
        app = FastAPI()
        auth = APIKeyWithRateLimit(
            name="X-API-Key",
            rate_limit="100/minute",
            deprecated_keys=["old-key-123"],
        )

        @app.get("/test")
        async def test_endpoint(api_key: str = Depends(auth)):
            return {"key": api_key}

        client = TestClient(app)
        response = client.get("/test", headers={"X-API-Key": "new-key-456"})

        assert response.status_code == 200
        assert "Warning" not in response.headers

    def test_missing_api_key_auto_error(self):
        """Missing API key with auto_error=True should return 401."""
        app = FastAPI()
        auth = APIKeyWithRateLimit(name="X-API-Key", rate_limit="100/minute")

        @app.get("/test")
        async def test_endpoint(api_key: str = Depends(auth)):
            return {"key": api_key}

        client = TestClient(app)
        response = client.get("/test")

        assert response.status_code == 401

    def test_missing_api_key_no_auto_error(self):
        """Missing API key with auto_error=False should return None."""
        app = FastAPI()
        auth = APIKeyWithRateLimit(
            name="X-API-Key",
            rate_limit="100/minute",
            auto_error=False,
        )

        @app.get("/test")
        async def test_endpoint(api_key: str = Depends(auth)):
            return {"key": api_key or "none"}

        client = TestClient(app)
        response = client.get("/test")

        assert response.status_code == 200
        assert response.json()["key"] == "none"

    def test_deprecated_key_still_works(self):
        """Deprecated key should still authenticate (with warning)."""
        app = FastAPI()
        auth = APIKeyWithRateLimit(
            name="X-API-Key",
            rate_limit="100/minute",
            deprecated_keys=["deprecated-1", "deprecated-2"],
        )

        @app.get("/test")
        async def test_endpoint(api_key: str = Depends(auth)):
            return {"key": api_key}

        client = TestClient(app)

        # Both deprecated keys should work
        for key in ["deprecated-1", "deprecated-2"]:
            response = client.get("/test", headers={"X-API-Key": key})
            assert response.status_code == 200
            assert response.json()["key"] == key

    def test_rate_limit_per_key_independent(self):
        """Rate limits should be independent per API key."""
        app = FastAPI()
        auth = APIKeyWithRateLimit(name="X-API-Key", rate_limit="2/minute")

        @app.get("/test")
        async def test_endpoint(api_key: str = Depends(auth)):
            return {"key": api_key}

        client = TestClient(app)

        # Key A uses up its limit
        client.get("/test", headers={"X-API-Key": "key-a"})
        client.get("/test", headers={"X-API-Key": "key-a"})
        response_a = client.get("/test", headers={"X-API-Key": "key-a"})
        assert response_a.status_code == 429

        # Key B should still work
        response_b = client.get("/test", headers={"X-API-Key": "key-b"})
        assert response_b.status_code == 200
