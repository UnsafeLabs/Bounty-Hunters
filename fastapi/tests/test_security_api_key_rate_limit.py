from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import FastAPI, Security
from fastapi.security import APIKeyWithRateLimit
from fastapi.testclient import TestClient
from starlette.exceptions import HTTPException


class Clock:
    def __init__(self, now: float = 1000.0):
        self.now = now

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def create_client(security: APIKeyWithRateLimit) -> TestClient:
    app = FastAPI()

    @app.get("/items/")
    def read_items(api_key: str | None = Security(security)):
        if api_key is None:
            return {"api_key": None}
        return {"api_key": api_key}

    return TestClient(app)


def create_security(
    *,
    clock: Clock | None = None,
    rate_limit: str = "2/minute",
    deprecated_keys: list[str] | None = None,
    auto_error: bool = True,
) -> APIKeyWithRateLimit:
    return APIKeyWithRateLimit(
        name="key",
        rate_limit=rate_limit,
        deprecated_keys=deprecated_keys,
        auto_error=auto_error,
        time_func=clock,
    )


def test_rate_limit_is_enforced_per_api_key_with_retry_after():
    clock = Clock()
    client = create_client(create_security(clock=clock))

    assert client.get("/items/", headers={"key": "alpha"}).status_code == 200
    assert client.get("/items/", headers={"key": "alpha"}).status_code == 200
    limited = client.get("/items/", headers={"key": "alpha"})
    other_key = client.get("/items/", headers={"key": "beta"})

    assert limited.status_code == 429, limited.text
    assert limited.json() == {"detail": "Rate limit exceeded"}
    assert limited.headers["Retry-After"] == "60"
    assert other_key.status_code == 200, other_key.text
    assert other_key.json() == {"api_key": "beta"}


def test_retry_after_uses_oldest_request_in_sliding_window():
    clock = Clock()
    client = create_client(create_security(clock=clock))

    client.get("/items/", headers={"key": "alpha"})
    clock.advance(15)
    client.get("/items/", headers={"key": "alpha"})
    limited = client.get("/items/", headers={"key": "alpha"})

    assert limited.status_code == 429, limited.text
    assert limited.headers["Retry-After"] == "45"


def test_sliding_window_resets_expired_counts():
    clock = Clock()
    client = create_client(create_security(clock=clock))

    client.get("/items/", headers={"key": "alpha"})
    client.get("/items/", headers={"key": "alpha"})
    assert client.get("/items/", headers={"key": "alpha"}).status_code == 429

    clock.advance(61)
    response = client.get("/items/", headers={"key": "alpha"})

    assert response.status_code == 200, response.text
    assert response.json() == {"api_key": "alpha"}


def test_deprecated_keys_authenticate_with_warning_header():
    client = create_client(create_security(deprecated_keys=["old-key"]))

    deprecated = client.get("/items/", headers={"key": "old-key"})
    active = client.get("/items/", headers={"key": "new-key"})

    assert deprecated.status_code == 200, deprecated.text
    assert deprecated.json() == {"api_key": "old-key"}
    assert deprecated.headers["Warning"] == (
        '299 - "API key is deprecated and will be deactivated"'
    )
    assert "Warning" not in active.headers


def test_deprecated_key_warning_is_preserved_on_rate_limit():
    client = create_client(create_security(deprecated_keys=["old-key"]))

    client.get("/items/", headers={"key": "old-key"})
    client.get("/items/", headers={"key": "old-key"})
    limited = client.get("/items/", headers={"key": "old-key"})

    assert limited.status_code == 429, limited.text
    assert limited.headers["Warning"] == (
        '299 - "API key is deprecated and will be deactivated"'
    )


def test_optional_missing_key_keeps_existing_behavior():
    client = create_client(create_security(auto_error=False))

    response = client.get("/items/")

    assert response.status_code == 200, response.text
    assert response.json() == {"api_key": None}


def test_invalid_rate_limit_format_raises_value_error():
    with pytest.raises(ValueError, match="rate_limit"):
        APIKeyWithRateLimit(name="key", rate_limit="minute/100")
    with pytest.raises(ValueError, match="rate_limit"):
        APIKeyWithRateLimit(name="key", rate_limit="0/minute")
    with pytest.raises(ValueError, match="rate_limit"):
        APIKeyWithRateLimit(name="key", rate_limit="100/month")


def test_rate_limit_store_is_thread_safe():
    security = create_security(rate_limit="50/minute")

    def attempt(index: int) -> bool:
        try:
            security._check_rate_limit(f"key-{index % 5}", {})
        except HTTPException:
            return False
        return True

    with ThreadPoolExecutor(max_workers=10) as executor:
        results = list(executor.map(attempt, range(100)))

    assert all(results)
