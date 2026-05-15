import asyncio

import pytest
from fastapi.security import APIKeyWithRateLimit
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import Response


def make_request(key: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/users/me",
            "headers": [(b"key", key.encode())],
            "query_string": b"",
        }
    )


def call_api_key(api_key: APIKeyWithRateLimit, key: str) -> tuple[str | None, Response]:
    response = Response()
    result = asyncio.run(api_key(make_request(key), response))
    return result, response


def make_api_key(
    *,
    rate_limit: str = "2/minute",
    deprecated_keys: set[str] | None = None,
) -> APIKeyWithRateLimit:
    return APIKeyWithRateLimit(
        name="key", rate_limit=rate_limit, deprecated_keys=deprecated_keys
    )


def test_api_key_rate_limit_enforced(monkeypatch):
    now = 1000.0
    monkeypatch.setattr(APIKeyWithRateLimit, "_now", lambda self: now)
    api_key = make_api_key()

    result, _ = call_api_key(api_key, "secret")
    assert result == "secret"
    result, _ = call_api_key(api_key, "secret")
    assert result == "secret"

    with pytest.raises(HTTPException) as exc_info:
        call_api_key(api_key, "secret")
    assert exc_info.value.status_code == 429
    assert exc_info.value.detail == "Rate limit exceeded"
    assert exc_info.value.headers == {"Retry-After": "60"}


def test_api_key_rate_limit_window_resets(monkeypatch):
    now = 1000.0
    monkeypatch.setattr(APIKeyWithRateLimit, "_now", lambda self: now)
    api_key = make_api_key()

    assert call_api_key(api_key, "secret")[0] == "secret"
    assert call_api_key(api_key, "secret")[0] == "secret"
    with pytest.raises(HTTPException):
        call_api_key(api_key, "secret")

    now = 1060.0
    result, _ = call_api_key(api_key, "secret")
    assert result == "secret"


def test_api_key_deprecated_warning_header():
    api_key = make_api_key(rate_limit="10/minute", deprecated_keys={"old-secret"})

    result, response = call_api_key(api_key, "old-secret")
    assert result == "old-secret"
    assert response.headers["Warning"] == '299 - "API key is deprecated"'

    result, response = call_api_key(api_key, "new-secret")
    assert result == "new-secret"
    assert "Warning" not in response.headers
