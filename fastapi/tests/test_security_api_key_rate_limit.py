from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import Depends, FastAPI
from fastapi.security import APIKeyWithRateLimit
from fastapi.testclient import TestClient
from starlette.exceptions import HTTPException


def create_client(
    rate_limit: str = "2/minute",
    deprecated_keys: list[str] | None = None,
    auto_error: bool = True,
) -> tuple[TestClient, APIKeyWithRateLimit]:
    app = FastAPI()
    api_key = APIKeyWithRateLimit(
        name="key",
        rate_limit=rate_limit,
        deprecated_keys=deprecated_keys,
        auto_error=auto_error,
    )

    @app.get("/items")
    def read_items(key: str | None = Depends(api_key)) -> dict[str, str | None]:
        return {"key": key}

    return TestClient(app), api_key


def test_rate_limit_tracks_requests_per_api_key_independently() -> None:
    client, security = create_client()
    security._time_provider = lambda: 100.0

    assert client.get("/items", headers={"key": "alpha"}).status_code == 200
    assert client.get("/items", headers={"key": "alpha"}).status_code == 200

    limited = client.get("/items", headers={"key": "alpha"})
    assert limited.status_code == 429
    assert limited.json() == {"detail": "Rate limit exceeded"}

    response = client.get("/items", headers={"key": "beta"})
    assert response.status_code == 200
    assert response.json() == {"key": "beta"}


def test_rate_limit_includes_retry_after_seconds() -> None:
    client, security = create_client()
    now = 100.0
    security._time_provider = lambda: now

    client.get("/items", headers={"key": "alpha"})
    client.get("/items", headers={"key": "alpha"})

    now = 110.0
    response = client.get("/items", headers={"key": "alpha"})

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "50"


def test_rate_limit_window_resets_after_expired_counts() -> None:
    client, security = create_client()
    now = 100.0
    security._time_provider = lambda: now

    assert client.get("/items", headers={"key": "alpha"}).status_code == 200
    assert client.get("/items", headers={"key": "alpha"}).status_code == 200

    now = 161.0
    response = client.get("/items", headers={"key": "alpha"})

    assert response.status_code == 200
    assert response.json() == {"key": "alpha"}


def test_rate_limit_store_handles_concurrent_requests_safely() -> None:
    _client, security = create_client(rate_limit="20/minute")
    security._time_provider = lambda: 100.0

    def check_limit() -> bool:
        try:
            security._check_rate_limit("alpha")
        except HTTPException as exc:
            assert exc.status_code == 429
            return False
        return True

    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(lambda _index: check_limit(), range(40)))

    assert results.count(True) == 20
    assert results.count(False) == 20


def test_deprecated_key_authenticates_with_warning_header() -> None:
    client, security = create_client(deprecated_keys=["old-key"])
    security._time_provider = lambda: 100.0

    response = client.get("/items", headers={"key": "old-key"})

    assert response.status_code == 200
    assert response.json() == {"key": "old-key"}
    assert response.headers["Warning"] == (
        '299 - "API key is deprecated and will be deactivated"'
    )


def test_active_key_has_no_warning_header() -> None:
    client, security = create_client(deprecated_keys=["old-key"])
    security._time_provider = lambda: 100.0

    response = client.get("/items", headers={"key": "new-key"})

    assert response.status_code == 200
    assert "Warning" not in response.headers


def test_api_key_with_rate_limit_keeps_api_key_header_authentication_behavior() -> None:
    client, _security = create_client()

    response = client.get("/items")

    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated"}
    assert response.headers["WWW-Authenticate"] == "APIKey"


def test_auto_error_false_returns_none_without_rate_limiting() -> None:
    client, security = create_client(auto_error=False)
    security._time_provider = lambda: 100.0

    response = client.get("/items")

    assert response.status_code == 200
    assert response.json() == {"key": None}
    assert security._request_timestamps == {}


@pytest.mark.parametrize("rate_limit", ["0/minute", "not-a-limit", "10/day"])
def test_invalid_rate_limit_format_is_rejected(rate_limit: str) -> None:
    with pytest.raises(ValueError, match="rate_limit"):
        APIKeyWithRateLimit(name="key", rate_limit=rate_limit)
