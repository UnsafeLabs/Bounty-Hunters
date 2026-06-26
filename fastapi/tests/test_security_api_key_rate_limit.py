from concurrent.futures import ThreadPoolExecutor
from typing import Annotated

import pytest
from fastapi import Depends, FastAPI
from fastapi.security import APIKeyHeader, APIKeyWithRateLimit
from fastapi.testclient import TestClient


def build_client(api_key_scheme: APIKeyWithRateLimit) -> TestClient:
    app = FastAPI()

    @app.get("/items/")
    def read_items(api_key: Annotated[str | None, Depends(api_key_scheme)]):
        return {"api_key": api_key}

    return TestClient(app)


def test_existing_api_key_header_export_is_unchanged():
    assert APIKeyHeader(name="key").__class__.__name__ == "APIKeyHeader"


def test_api_key_rate_limit_enforces_per_key_limit_with_retry_after():
    current_time = [100.0]
    api_key_scheme = APIKeyWithRateLimit(name="x-key", rate_limit="2/minute")
    api_key_scheme._time = lambda: current_time[0]
    client = build_client(api_key_scheme)

    first = client.get("/items/", headers={"x-key": "alpha"})
    second = client.get("/items/", headers={"x-key": "alpha"})
    third = client.get("/items/", headers={"x-key": "alpha"})
    independent_key = client.get("/items/", headers={"x-key": "beta"})

    assert first.status_code == 200
    assert second.status_code == 200
    assert third.status_code == 429
    assert third.headers["retry-after"] == "60"
    assert third.json() == {"detail": "Rate limit exceeded"}
    assert independent_key.status_code == 200
    assert independent_key.json() == {"api_key": "beta"}


def test_api_key_rate_limit_resets_after_window_expires():
    current_time = [10.0]
    api_key_scheme = APIKeyWithRateLimit(name="x-key", rate_limit="1/minute")
    api_key_scheme._time = lambda: current_time[0]
    client = build_client(api_key_scheme)

    assert client.get("/items/", headers={"x-key": "alpha"}).status_code == 200
    assert client.get("/items/", headers={"x-key": "alpha"}).status_code == 429

    current_time[0] = 70.0

    assert client.get("/items/", headers={"x-key": "alpha"}).status_code == 200


def test_deprecated_api_key_adds_warning_header_but_active_key_does_not():
    api_key_scheme = APIKeyWithRateLimit(
        name="x-key",
        rate_limit="10/minute",
        deprecated_keys=["old-key"],
    )
    client = build_client(api_key_scheme)

    deprecated_response = client.get("/items/", headers={"x-key": "old-key"})
    active_response = client.get("/items/", headers={"x-key": "new-key"})

    assert deprecated_response.status_code == 200
    assert "deprecated" in deprecated_response.headers["warning"]
    assert active_response.status_code == 200
    assert "warning" not in active_response.headers


def test_deprecated_api_key_warning_is_preserved_on_rate_limit_response():
    current_time = [30.0]
    api_key_scheme = APIKeyWithRateLimit(
        name="x-key",
        rate_limit="1/minute",
        deprecated_keys=["old-key"],
    )
    api_key_scheme._time = lambda: current_time[0]
    client = build_client(api_key_scheme)

    assert client.get("/items/", headers={"x-key": "old-key"}).status_code == 200
    response = client.get("/items/", headers={"x-key": "old-key"})

    assert response.status_code == 429
    assert response.headers["retry-after"] == "60"
    assert "deprecated" in response.headers["warning"]


def test_optional_missing_api_key_skips_rate_limit():
    api_key_scheme = APIKeyWithRateLimit(
        name="x-key", rate_limit="1/minute", auto_error=False
    )
    client = build_client(api_key_scheme)

    first = client.get("/items/")
    second = client.get("/items/")

    assert first.status_code == 200
    assert first.json() == {"api_key": None}
    assert second.status_code == 200
    assert second.json() == {"api_key": None}


@pytest.mark.parametrize("rate_limit", ["0/minute", "10/week", "abc"])
def test_api_key_rate_limit_rejects_invalid_limits(rate_limit: str):
    with pytest.raises(ValueError):
        APIKeyWithRateLimit(name="x-key", rate_limit=rate_limit)


def test_api_key_rate_limit_store_handles_concurrent_requests():
    api_key_scheme = APIKeyWithRateLimit(name="x-key", rate_limit="50/minute")

    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(
            executor.map(
                lambda _: api_key_scheme._record_request("shared-key"),
                range(20),
            )
        )

    assert results == [None] * 20
    assert len(api_key_scheme._requests["shared-key"]) == 20
