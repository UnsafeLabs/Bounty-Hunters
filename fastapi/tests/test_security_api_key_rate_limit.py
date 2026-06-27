from concurrent.futures import ThreadPoolExecutor
from typing import Annotated

import pytest
from fastapi import Depends, FastAPI
from fastapi.security import (
    APIKeyCookie,
    APIKeyCookieWithRateLimit,
    APIKeyHeader,
    APIKeyQuery,
    APIKeyQueryWithRateLimit,
    APIKeyWithRateLimit,
)
from fastapi.testclient import TestClient


def build_client(api_key_scheme) -> TestClient:
    app = FastAPI()

    @app.get("/items/")
    def read_items(api_key: Annotated[str | None, Depends(api_key_scheme)]):
        return {"api_key": api_key}

    return TestClient(app)


def test_existing_api_key_header_export_is_unchanged():
    assert APIKeyHeader(name="key").__class__.__name__ == "APIKeyHeader"
    assert APIKeyQuery(name="key").__class__.__name__ == "APIKeyQuery"
    assert APIKeyCookie(name="key").__class__.__name__ == "APIKeyCookie"


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


def test_query_api_key_rate_limit_uses_query_parameter_values():
    current_time = [100.0]
    api_key_scheme = APIKeyQueryWithRateLimit(name="api_key", rate_limit="1/minute")
    api_key_scheme._time = lambda: current_time[0]
    client = build_client(api_key_scheme)

    first = client.get("/items/?api_key=alpha")
    second = client.get("/items/?api_key=alpha")
    independent_key = client.get("/items/?api_key=beta")

    assert first.status_code == 200
    assert first.json() == {"api_key": "alpha"}
    assert second.status_code == 429
    assert second.headers["retry-after"] == "60"
    assert independent_key.status_code == 200
    assert independent_key.json() == {"api_key": "beta"}


def test_cookie_api_key_rate_limit_uses_cookie_values():
    current_time = [200.0]
    api_key_scheme = APIKeyCookieWithRateLimit(name="session", rate_limit="1/minute")
    api_key_scheme._time = lambda: current_time[0]
    client = build_client(api_key_scheme)

    client.cookies.set("session", "alpha")
    first = client.get("/items/")
    second = client.get("/items/")
    client.cookies.set("session", "beta")
    independent_key = client.get("/items/")

    assert first.status_code == 200
    assert first.json() == {"api_key": "alpha"}
    assert second.status_code == 429
    assert second.headers["retry-after"] == "60"
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


def test_deprecated_query_and_cookie_keys_add_warning_headers():
    query_scheme = APIKeyQueryWithRateLimit(
        name="api_key",
        rate_limit="10/minute",
        deprecated_keys=["old-query"],
    )
    cookie_scheme = APIKeyCookieWithRateLimit(
        name="session",
        rate_limit="10/minute",
        deprecated_keys=["old-cookie"],
    )

    query_response = build_client(query_scheme).get("/items/?api_key=old-query")
    cookie_client = build_client(cookie_scheme)
    cookie_client.cookies.set("session", "old-cookie")
    cookie_response = cookie_client.get("/items/")

    assert query_response.status_code == 200
    assert "deprecated" in query_response.headers["warning"]
    assert cookie_response.status_code == 200
    assert "deprecated" in cookie_response.headers["warning"]


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


def test_optional_missing_query_and_cookie_keys_skip_rate_limit():
    query_client = build_client(
        APIKeyQueryWithRateLimit(
            name="api_key", rate_limit="1/minute", auto_error=False
        )
    )
    cookie_client = build_client(
        APIKeyCookieWithRateLimit(
            name="session", rate_limit="1/minute", auto_error=False
        )
    )

    assert query_client.get("/items/").status_code == 200
    assert query_client.get("/items/").status_code == 200
    assert cookie_client.get("/items/").status_code == 200
    assert cookie_client.get("/items/").status_code == 200


@pytest.mark.parametrize("rate_limit", ["0/minute", "10/week", "abc"])
def test_api_key_rate_limit_rejects_invalid_limits(rate_limit: str):
    with pytest.raises(ValueError):
        APIKeyWithRateLimit(name="x-key", rate_limit=rate_limit)
    with pytest.raises(ValueError):
        APIKeyQueryWithRateLimit(name="api_key", rate_limit=rate_limit)
    with pytest.raises(ValueError):
        APIKeyCookieWithRateLimit(name="session", rate_limit=rate_limit)


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
