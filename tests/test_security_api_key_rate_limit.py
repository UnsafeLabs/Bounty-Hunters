"""Tests for API key rate limiting and deprecation warnings."""
import threading
import time
from unittest.mock import patch

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from fastapi.security import APIKeyWithRateLimit
from fastapi.security.api_key import parse_rate_limit, RateLimitStore


# ============================================================================
# Rate Limit Parsing Tests
# ============================================================================

def test_parse_rate_limit_second():
    max_req, window = parse_rate_limit("10/second")
    assert max_req == 10
    assert window == 1


def test_parse_rate_limit_minute():
    max_req, window = parse_rate_limit("100/minute")
    assert max_req == 100
    assert window == 60


def test_parse_rate_limit_hour():
    max_req, window = parse_rate_limit("1000/hour")
    assert max_req == 1000
    assert window == 3600


def test_parse_rate_limit_day():
    max_req, window = parse_rate_limit("10000/day")
    assert max_req == 10000
    assert window == 86400


def test_parse_rate_limit_case_insensitive():
    max_req, window = parse_rate_limit("100/MINUTE")
    assert max_req == 100
    assert window == 60


def test_parse_rate_limit_invalid_format():
    with pytest.raises(ValueError, match="Invalid rate limit format"):
        parse_rate_limit("invalid")


def test_parse_rate_limit_invalid_period():
    with pytest.raises(ValueError, match="Invalid rate limit format"):
        parse_rate_limit("100/week")


def test_parse_rate_limit_zero_requests():
    max_req, window = parse_rate_limit("0/minute")
    assert max_req == 0
    assert window == 60


def test_parse_rate_limit_negative_requests():
    with pytest.raises(ValueError, match="Invalid rate limit format"):
        parse_rate_limit("-1/minute")


# ============================================================================
# RateLimitStore Tests
# ============================================================================

def test_rate_limit_store_allows_within_limit():
    store = RateLimitStore()
    allowed, retry_after = store.check_and_update("key1", 10, 60)
    assert allowed is True
    assert retry_after is None


def test_rate_limit_store_blocks_over_limit():
    store = RateLimitStore()
    # Exhaust the limit
    for _ in range(10):
        store.check_and_update("key1", 10, 60)
    
    # Next request should be blocked
    allowed, retry_after = store.check_and_update("key1", 10, 60)
    assert allowed is False
    assert retry_after is not None
    assert retry_after > 0


def test_rate_limit_store_different_keys_independent():
    store = RateLimitStore()
    # Exhaust limit for key1
    for _ in range(10):
        store.check_and_update("key1", 10, 60)
    
    # key2 should still be allowed
    allowed, retry_after = store.check_and_update("key2", 10, 60)
    assert allowed is True


def test_rate_limit_store_window_reset():
    store = RateLimitStore()
    # Add some requests with a very short window
    for _ in range(5):
        store.check_and_update("key1", 5, 1)
    
    # Wait for window to reset
    time.sleep(1.1)
    
    # Should be allowed again
    allowed, retry_after = store.check_and_update("key1", 5, 1)
    assert allowed is True


def test_rate_limit_store_get_usage():
    store = RateLimitStore()
    for _ in range(5):
        store.check_and_update("key1", 10, 60)
    
    usage = store.get_usage("key1", 60)
    assert usage == 5


def test_rate_limit_store_concurrent_access():
    store = RateLimitStore()
    results = []
    
    def make_request():
        allowed, _ = store.check_and_update("key1", 50, 60)
        results.append(allowed)
    
    threads = [threading.Thread(target=make_request) for _ in range(50)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    
    assert len(results) == 50
    assert sum(results) == 50  # All should be allowed (exactly at limit)


# ============================================================================
# APIKeyWithRateLimit Integration Tests
# ============================================================================

def test_api_key_with_rate_limit_success():
    app = FastAPI()
    scheme = APIKeyWithRateLimit(name="X-API-Key", rate_limit="10/minute")
    
    @app.get("/test")
    async def test_route(api_key: str = Depends(scheme)):
        return {"api_key": api_key}
    
    client = TestClient(app)
    response = client.get("/test", headers={"X-API-Key": "test-key"})
    assert response.status_code == 200
    assert response.json() == {"api_key": "test-key"}


def test_api_key_with_rate_limit_missing_key():
    app = FastAPI()
    scheme = APIKeyWithRateLimit(name="X-API-Key", rate_limit="10/minute")
    
    @app.get("/test")
    async def test_route(api_key: str = Depends(scheme)):
        return {"api_key": api_key}
    
    client = TestClient(app)
    response = client.get("/test")
    assert response.status_code == 401


def test_api_key_with_rate_limit_exceeded():
    app = FastAPI()
    scheme = APIKeyWithRateLimit(name="X-API-Key", rate_limit="5/minute")
    
    @app.get("/test")
    async def test_route(api_key: str = Depends(scheme)):
        return {"api_key": api_key}
    
    client = TestClient(app)
    
    # Exhaust the limit
    for _ in range(5):
        response = client.get("/test", headers={"X-API-Key": "test-key"})
        assert response.status_code == 200
    
    # Next request should be rate limited
    response = client.get("/test", headers={"X-API-Key": "test-key"})
    assert response.status_code == 429
    assert "Retry-After" in response.headers


def test_api_key_with_rate_limit_auto_error_false():
    app = FastAPI()
    scheme = APIKeyWithRateLimit(name="X-API-Key", rate_limit="10/minute", auto_error=False)
    
    @app.get("/test")
    async def test_route(api_key: str = Depends(scheme)):
        return {"api_key": api_key}
    
    client = TestClient(app)
    response = client.get("/test")
    assert response.status_code == 200
    assert response.json() == {"api_key": None}


def test_api_key_with_rate_limit_different_keys_separate_limits():
    app = FastAPI()
    scheme = APIKeyWithRateLimit(name="X-API-Key", rate_limit="3/minute")
    
    @app.get("/test")
    async def test_route(api_key: str = Depends(scheme)):
        return {"api_key": api_key}
    
    client = TestClient(app)
    
    # Exhaust limit for key1
    for _ in range(3):
        response = client.get("/test", headers={"X-API-Key": "key1"})
        assert response.status_code == 200
    
    # key1 should be rate limited
    response = client.get("/test", headers={"X-API-Key": "key1"})
    assert response.status_code == 429
    
    # key2 should still work
    response = client.get("/test", headers={"X-API-Key": "key2"})
    assert response.status_code == 200


# ============================================================================
# Deprecation Warning Tests
# ============================================================================

def test_api_key_with_rate_limit_deprecated_key():
    app = FastAPI()
    scheme = APIKeyWithRateLimit(
        name="X-API-Key",
        rate_limit="10/minute",
        deprecated_keys=["old-key"],
    )
    
    @app.get("/test")
    async def test_route(api_key: str = Depends(scheme)):
        return {"api_key": api_key}
    
    client = TestClient(app)
    response = client.get("/test", headers={"X-API-Key": "old-key"})
    assert response.status_code == 200
    # Verify Warning header is present for deprecated keys
    assert "Warning" in response.headers
    assert "deprecated" in response.headers["Warning"].lower()


def test_api_key_with_rate_limit_non_deprecated_key_no_warning():
    app = FastAPI()
    scheme = APIKeyWithRateLimit(
        name="X-API-Key",
        rate_limit="10/minute",
        deprecated_keys=["old-key"],
    )
    
    @app.get("/test")
    async def test_route(api_key: str = Depends(scheme)):
        return {"api_key": api_key}
    
    client = TestClient(app)
    response = client.get("/test", headers={"X-API-Key": "new-key"})
    assert response.status_code == 200
    # Verify Warning header is NOT present for non-deprecated keys
    assert "Warning" not in response.headers


def test_api_key_with_rate_limit_deprecated_key_with_usage():
    """Test deprecated key works correctly with rate limiting."""
    app = FastAPI()
    scheme = APIKeyWithRateLimit(
        name="X-API-Key",
        rate_limit="3/minute",
        deprecated_keys=["old-key"],
    )
    
    @app.get("/test")
    async def test_route(api_key: str = Depends(scheme)):
        return {"api_key": api_key}
    
    client = TestClient(app)
    
    # Make requests with deprecated key
    for i in range(3):
        response = client.get("/test", headers={"X-API-Key": "old-key"})
        assert response.status_code == 200
        assert "Warning" in response.headers
    
    # Rate limited
    response = client.get("/test", headers={"X-API-Key": "old-key"})
    assert response.status_code == 429


def test_api_key_with_rate_limit_mixed_deprecated_and_regular():
    """Test that deprecated and regular keys work independently."""
    app = FastAPI()
    scheme = APIKeyWithRateLimit(
        name="X-API-Key",
        rate_limit="3/minute",
        deprecated_keys=["old-key"],
    )
    
    @app.get("/test")
    async def test_route(api_key: str = Depends(scheme)):
        return {"api_key": api_key}
    
    client = TestClient(app)
    
    # Use deprecated key
    response = client.get("/test", headers={"X-API-Key": "old-key"})
    assert response.status_code == 200
    assert "Warning" in response.headers
    
    # Use regular key
    response = client.get("/test", headers={"X-API-Key": "new-key"})
    assert response.status_code == 200
    assert "Warning" not in response.headers
    
    # Both should have independent rate limits
    for _ in range(2):
        client.get("/test", headers={"X-API-Key": "old-key"})
        client.get("/test", headers={"X-API-Key": "new-key"})
    
    # Both should be rate limited independently
    response = client.get("/test", headers={"X-API-Key": "old-key"})
    assert response.status_code == 429
    
    response = client.get("/test", headers={"X-API-Key": "new-key"})
    assert response.status_code == 429
