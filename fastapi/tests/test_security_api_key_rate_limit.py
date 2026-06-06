import pytest
from starlette.exceptions import HTTPException
from starlette.responses import Response

from fastapi.security import APIKeyWithRateLimit


class FakeRequest:
    def __init__(self, key: str | None):
        self.headers = {}
        if key is not None:
            self.headers["key"] = key


@pytest.mark.anyio
async def test_rate_limit_tracks_keys_independently():
    security = APIKeyWithRateLimit(name="key", rate_limit="2/minute")

    assert await security(FakeRequest("a"), Response()) == "a"
    assert await security(FakeRequest("b"), Response()) == "b"
    assert await security(FakeRequest("a"), Response()) == "a"

    with pytest.raises(HTTPException) as exc:
        await security(FakeRequest("a"), Response())

    assert exc.value.status_code == 429
    assert "Retry-After" in exc.value.headers
    assert await security(FakeRequest("b"), Response()) == "b"


@pytest.mark.anyio
async def test_window_reset_removes_expired_counts(monkeypatch):
    now = 1000.0
    monkeypatch.setattr("fastapi.security.api_key.time.monotonic", lambda: now)
    security = APIKeyWithRateLimit(name="key", rate_limit="1/second")

    assert await security(FakeRequest("secret"), Response()) == "secret"

    with pytest.raises(HTTPException):
        await security(FakeRequest("secret"), Response())

    now = 1002.0

    assert await security(FakeRequest("secret"), Response()) == "secret"


@pytest.mark.anyio
async def test_deprecated_keys_add_warning_header():
    security = APIKeyWithRateLimit(
        name="key",
        rate_limit="10/minute",
        deprecated_keys=["old-secret"],
    )
    response = Response()

    assert await security(FakeRequest("old-secret"), response) == "old-secret"
    assert "deprecated" in response.headers["Warning"]


@pytest.mark.anyio
async def test_non_deprecated_key_has_no_warning_header():
    security = APIKeyWithRateLimit(
        name="key",
        rate_limit="10/minute",
        deprecated_keys=["old-secret"],
    )
    response = Response()

    assert await security(FakeRequest("new-secret"), response) == "new-secret"
    assert "Warning" not in response.headers
