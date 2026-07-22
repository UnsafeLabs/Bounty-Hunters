import time
import threading
from unittest.mock import MagicMock

import pytest
from fastapi import Depends, FastAPI
from fastapi.security import APIKeyWithRateLimit
from fastapi.testclient import TestClient
from starlette.status import HTTP_401_UNAUTHORIZED, HTTP_429_TOO_MANY_REQUESTS

from fastapi.security.api_key import _parse_rate_limit, RateLimitStore


def test_parse_rate_limit_valid():
    assert _parse_rate_limit("100/minute") == (100, 60)
    assert _parse_rate_limit("10/second") == (10, 1)
    assert _parse_rate_limit("1000/hour") == (1000, 3600)
    assert _parse_rate_limit("50/day") == (50, 86400)
    assert _parse_rate_limit("100/minutes") == (100, 60)
    assert _parse_rate_limit("10/Seconds") == (10, 1)


def test_parse_rate_limit_invalid():
    with pytest.raises(ValueError):
        _parse_rate_limit("invalid")

    with pytest.raises(ValueError):
        _parse_rate_limit("100")

    with pytest.raises(ValueError):
        _parse_rate_limit("100/unknown")


def test_rate_limit_store_allows_within_limit():
    store = RateLimitStore()
    allowed, retry_after = store.check_and_update("key1", max_requests=5, window_seconds=60)
    assert allowed is True
    assert retry_after == 0


def test_rate_limit_store_blocks_over_limit():
    store = RateLimitStore()
    for _ in range(5):
        allowed, _ = store.check_and_update("key1", max_requests=5, window_seconds=60)
        assert allowed is True

    allowed, retry_after = store.check_and_update("key1", max_requests=5, window_seconds=60)
    assert allowed is False
    assert retry_after > 0


def test_rate_limit_store_different_keys_independent():
    store = RateLimitStore()
    for _ in range(5):
        store.check_and_update("key1", max_requests=5, window_seconds=60)

    allowed, _ = store.check_and_update("key2", max_requests=5, window_seconds=60)
    assert allowed is True


def test_rate_limit_store_window_reset():
    store = RateLimitStore()
    for _ in range(5):
        store.check_and_update("key1", max_requests=5, window_seconds=1)

    time.sleep(1.1)
    allowed, _ = store.check_and_update("key1", max_requests=5, window_seconds=1)
    assert allowed is True


def test_rate_limit_concurrent_access():
    store = RateLimitStore()
    results = []

    def worker():
        for _ in range(10):
            allowed, _ = store.check_and_update("key1", max_requests=50, window_seconds=60)
            results.append(allowed)

    threads = [threading.Thread(target=worker) for _ in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(results) == 50
    assert sum(results) == 50


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
    assert response.status_code == HTTP_401_UNAUTHORIZED


def test_api_key_with_rate_limit_exceeded():
    app = FastAPI()
    scheme = APIKeyWithRateLimit(name="X-API-Key", rate_limit="3/minute")

    @app.get("/test")
    async def test_route(api_key: str = Depends(scheme)):
        return {"api_key": api_key}

    client = TestClient(app)

    for _ in range(3):
        response = client.get("/test", headers={"X-API-Key": "test-key"})
        assert response.status_code == 200

    response = client.get("/test", headers={"X-API-Key": "test-key"})
    assert response.status_code == HTTP_429_TOO_MANY_REQUESTS
    assert "Retry-After" in response.headers
    assert int(response.headers["Retry-After"]) > 0


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


def test_api_key_with_rate_limit_auto_error_false():
    app = FastAPI()
    scheme = APIKeyWithRateLimit(
        name="X-API-Key",
        rate_limit="10/minute",
        auto_error=False,
    )

    @app.get("/test")
    async def test_route(api_key: str = Depends(scheme)):
        return {"api_key": api_key}

    client = TestClient(app)
    response = client.get("/test")
    assert response.status_code == 200
    assert response.json() == {"api_key": None}


def test_api_key_with_rate_limit_different_keys_separate_limits():
    app = FastAPI()
    scheme = APIKeyWithRateLimit(name="X-API-Key", rate_limit="2/minute")

    @app.get("/test")
    async def test_route(api_key: str = Depends(scheme)):
        return {"api_key": api_key}

    client = TestClient(app)

    response = client.get("/test", headers={"X-API-Key": "key1"})
    assert response.status_code == 200

    response = client.get("/test", headers={"X-API-Key": "key1"})
    assert response.status_code == 200

    response = client.get("/test", headers={"X-API-Key": "key1"})
    assert response.status_code == HTTP_429_TOO_MANY_REQUESTS

    response = client.get("/test", headers={"X-API-Key": "key2"})
    assert response.status_code == 200
