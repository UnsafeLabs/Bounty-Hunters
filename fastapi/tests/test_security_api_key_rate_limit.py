import pytest
from fastapi import Depends, FastAPI
from fastapi.security import APIKeyWithRateLimit
from fastapi.testclient import TestClient


def create_client(
    rate_limit: str = "2/minute",
    deprecated_keys: list[str] | None = None,
) -> tuple[TestClient, APIKeyWithRateLimit]:
    app = FastAPI()
    api_key = APIKeyWithRateLimit(
        name="key",
        rate_limit=rate_limit,
        deprecated_keys=deprecated_keys,
    )

    @app.get("/items")
    def read_items(key: str = Depends(api_key)) -> dict[str, str]:
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


def test_invalid_rate_limit_format_is_rejected() -> None:
    with pytest.raises(ValueError, match="rate_limit"):
        APIKeyWithRateLimit(name="key", rate_limit="not-a-limit")
