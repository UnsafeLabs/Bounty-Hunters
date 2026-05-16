from starlette.testclient import TestClient as TestClient  # noqa

from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from starlette.testclient import TestClient as StarletteTestClient


class FastAPITestClient(StarletteTestClient):
    """Extended TestClient with authentication helpers and WebSocket convenience.

    Usage::

        client = FastAPITestClient(app)
        client.authenticate("my-token")
        resp = client.get("/items")  # sends Authorization: Bearer my-token
        client.reset_auth()
    """

    def __init__(self, app: FastAPI, **kwargs: Any) -> None:
        super().__init__(app, **kwargs)
        self._headers: dict[str, str] = {}

    def authenticate(self, token: str) -> None:
        """Set Bearer token for all subsequent requests."""
        self._headers["Authorization"] = f"Bearer {token}"

    def authenticate_basic(self, username: str, password: str) -> None:
        """Set HTTP Basic auth for all subsequent requests."""
        import base64 as b64
        credentials = f"{username}:{password}"
        encoded = b64.b64encode(credentials.encode()).decode()
        self._headers["Authorization"] = f"Basic {encoded}"

    def reset_auth(self) -> None:
        """Clear authentication state."""
        self._headers.clear()

    def _add_auth(self, kwargs: dict[str, Any]) -> dict[str, Any]:
        """Merge auth headers into request kwargs."""
        if self._headers:
            existing = dict(kwargs.get("headers", {}) or {})
            existing.update(self._headers)
            kwargs["headers"] = existing
        return kwargs

    def get(self, url: str, **kwargs: Any) -> Any:
        return super().get(url, **self._add_auth(kwargs))

    def post(self, url: str, **kwargs: Any) -> Any:
        return super().post(url, **self._add_auth(kwargs))

    def put(self, url: str, **kwargs: Any) -> Any:
        return super().put(url, **self._add_auth(kwargs))

    def patch(self, url: str, **kwargs: Any) -> Any:
        return super().patch(url, **self._add_auth(kwargs))

    def delete(self, url: str, **kwargs: Any) -> Any:
        return super().delete(url, **self._add_auth(kwargs))

    def options(self, url: str, **kwargs: Any) -> Any:
        return super().options(url, **self._add_auth(kwargs))

    def head(self, url: str, **kwargs: Any) -> Any:
        return super().head(url, **self._add_auth(kwargs))

    def assert_status(self, method: str, url: str, expected: int, **kwargs: Any) -> Any:
        """Make a request and assert the response status code."""
        resp = getattr(self, method.lower())(url, **kwargs)
        if resp.status_code != expected:
            raise AssertionError(
                f"Expected status {expected}, got {resp.status_code} "
                f"for {method.upper()} {url}: {resp.text[:200]}"
            )
        return resp

    @asynccontextmanager
    async def ws_connect(
        self, url: str, headers: dict[str, str] | None = None, subprotocols: list[str] | None = None
    ) -> AsyncIterator[Any]:
        """Connect to a WebSocket with custom headers."""
        merged = dict(self._headers)
        if headers:
            merged.update(headers)
        async with super().websocket_connect(url, headers=merged, subprotocols=subprotocols) as ws:
            yield ws
