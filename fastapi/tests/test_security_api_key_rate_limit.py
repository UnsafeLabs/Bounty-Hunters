from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import Depends, FastAPI, Security
from fastapi.security import APIKeyHeader, APIKeyWithRateLimit
from fastapi.testclient import TestClient


def get_test_client(api_key: APIKeyWithRateLimit) -> TestClient:
    app = FastAPI()

    def get_current_key(key: str = Security(api_key)):
        return key

    @app.get("/items")
    def read_items(key: str = Depends(get_current_key)):
        return {"key": key}

    return TestClient(app)


def test_rate_limit_tracks_each_api_key_independently():
    api_key = APIKeyWithRateLimit(name="key", rate_limit="2/minute")
    client = get_test_client(api_key)

    assert client.get("/items", headers={"key": "alpha"}).status_code == 200
    assert client.get("/items", headers={"key": "alpha"}).status_code == 200
    blocked = client.get("/items", headers={"key": "alpha"})
    assert blocked.status_code == 429
    assert blocked.headers["Retry-After"] == "60"

    beta = client.get("/items", headers={"key": "beta"})
    assert beta.status_code == 200
    assert beta.json() == {"key": "beta"}


def test_sliding_window_resets_expired_counts():
    now = 1000.0
    api_key = APIKeyWithRateLimit(name="key", rate_limit="1/minute")
    api_key._time_func = lambda: now
    client = get_test_client(api_key)

    assert client.get("/items", headers={"key": "alpha"}).status_code == 200
    blocked = client.get("/items", headers={"key": "alpha"})
    assert blocked.status_code == 429
    assert blocked.headers["Retry-After"] == "60"

    now += 60

    assert client.get("/items", headers={"key": "alpha"}).status_code == 200


def test_retry_after_uses_remaining_window_seconds():
    now = 1000.0
    api_key = APIKeyWithRateLimit(name="key", rate_limit="1/minute")
    api_key._time_func = lambda: now
    client = get_test_client(api_key)

    assert client.get("/items", headers={"key": "alpha"}).status_code == 200
    now += 17.2
    blocked = client.get("/items", headers={"key": "alpha"})

    assert blocked.status_code == 429
    assert blocked.headers["Retry-After"] == "43"


def test_deprecated_key_adds_warning_header_and_still_authenticates():
    api_key = APIKeyWithRateLimit(
        name="key",
        rate_limit="2/minute",
        deprecated_keys=["old-secret"],
    )
    client = get_test_client(api_key)

    response = client.get("/items", headers={"key": "old-secret"})

    assert response.status_code == 200
    assert response.json() == {"key": "old-secret"}
    assert (
        response.headers["Warning"]
        == '299 - "API key is deprecated and will be deactivated"'
    )


def test_current_key_has_no_warning_header():
    api_key = APIKeyWithRateLimit(
        name="key",
        rate_limit="2/minute",
        deprecated_keys=["old-secret"],
    )
    client = get_test_client(api_key)

    response = client.get("/items", headers={"key": "current-secret"})

    assert response.status_code == 200
    assert "Warning" not in response.headers


def test_deprecated_rate_limited_key_keeps_warning_header():
    api_key = APIKeyWithRateLimit(
        name="key",
        rate_limit="1/minute",
        deprecated_keys=["old-secret"],
    )
    client = get_test_client(api_key)

    assert client.get("/items", headers={"key": "old-secret"}).status_code == 200
    blocked = client.get("/items", headers={"key": "old-secret"})

    assert blocked.status_code == 429
    assert blocked.headers["Retry-After"] == "60"
    assert (
        blocked.headers["Warning"]
        == '299 - "API key is deprecated and will be deactivated"'
    )


def test_in_memory_store_handles_concurrent_requests_safely():
    api_key = APIKeyWithRateLimit(name="key", rate_limit="3/minute")
    client = get_test_client(api_key)

    with ThreadPoolExecutor(max_workers=8) as executor:
        statuses = list(
            executor.map(
                lambda _: client.get("/items", headers={"key": "alpha"}).status_code,
                range(10),
            )
        )

    assert statuses.count(200) == 3
    assert statuses.count(429) == 7


def test_missing_key_preserves_api_key_header_behavior():
    api_key = APIKeyWithRateLimit(name="key", rate_limit="2/minute")
    client = get_test_client(api_key)

    response = client.get("/items")

    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated"}
    assert response.headers["WWW-Authenticate"] == "APIKey"


def test_optional_missing_key_does_not_rate_limit():
    app = FastAPI()
    api_key = APIKeyWithRateLimit(name="key", rate_limit="1/minute", auto_error=False)

    @app.get("/items")
    def read_items(key: str | None = Security(api_key)):
        return {"key": key}

    client = TestClient(app)

    assert client.get("/items").json() == {"key": None}
    assert client.get("/items").json() == {"key": None}


def test_invalid_rate_limit_configuration_is_rejected():
    with pytest.raises(ValueError, match="format"):
        APIKeyWithRateLimit(name="key", rate_limit="10")
    with pytest.raises(ValueError, match="greater than 0"):
        APIKeyWithRateLimit(name="key", rate_limit="0/minute")
    with pytest.raises(ValueError, match="window"):
        APIKeyWithRateLimit(name="key", rate_limit="10/month")


def test_existing_api_key_header_export_and_behavior_are_unchanged():
    api_key = APIKeyHeader(name="key")
    client = get_test_client(api_key)  # type: ignore[arg-type]

    response = client.get("/items", headers={"key": "secret"})

    assert response.status_code == 200
    assert response.json() == {"key": "secret"}
