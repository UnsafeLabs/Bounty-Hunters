from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, Optional
from urllib.parse import urlencode

from starlette.testclient import TestClient as TestClient, WebSocketTestSession  # noqa


class FastAPITestClient(TestClient):
    """Extended TestClient with auth helpers and WebSocket convenience methods."""

    def __init__(self, app, auth_token: Optional[str] = None, **kwargs):
        super().__init__(app, **kwargs)
        self._auth_token = auth_token
        self._auth_basic: Optional[tuple[str, str]] = None

    def authenticate(self, token: str) -> None:
        """Set Bearer token for all subsequent requests."""
        self._auth_token = token
        self._auth_basic = None

    def authenticate_basic(self, username: str, password: str) -> None:
        """Set HTTP Basic auth for all subsequent requests."""
        self._auth_basic = (username, password)
        self._auth_token = None

    def reset_auth(self) -> None:
        """Clear authentication state."""
        self._auth_token = None
        self._auth_basic = None

    def _apply_auth(self, kwargs: dict) -> dict:
        headers = kwargs.pop("headers", {}) or {}
        if self._auth_token:
            headers["Authorization"] = f"Bearer {self._auth_token}"
        elif self._auth_basic:
            import base64
            raw = f"{self._auth_basic[0]}:{self._auth_basic[1]}"
            encoded = base64.b64encode(raw.encode()).decode("ascii")
            headers["Authorization"] = f"Basic {encoded}"
        kwargs["headers"] = headers
        return kwargs

    def request(self, method: str, url: str, **kwargs) -> Any:
        kwargs = self._apply_auth(kwargs)
        return super().request(method, url, **kwargs)

    def get(self, url: str, **kwargs) -> Any:
        return self.request("GET", url, **kwargs)

    def post(self, url: str, **kwargs) -> Any:
        return self.request("POST", url, **kwargs)

    def put(self, url: str, **kwargs) -> Any:
        return self.request("PUT", url, **kwargs)

    def delete(self, url: str, **kwargs) -> Any:
        return self.request("DELETE", url, **kwargs)

    def patch(self, url: str, **kwargs) -> Any:
        return self.request("PATCH", url, **kwargs)

    def ws_connect(self, url: str, headers: Optional[dict] = None, subprotocols: Optional[list[str]] = None) -> WebSocketTestSession:
        """Connect to a WebSocket with optional custom headers and subprotocols."""
        kwargs: dict = {}
        if headers:
            kwargs["headers"] = headers
        if subprotocols:
            kwargs["subprotocols"] = subprotocols
        return self.__enter__()  # type: ignore
        return super().websocket_connect(url, **kwargs)

    def assert_status(self, method: str, url: str, expected: int, **kwargs) -> Any:
        """Make a request and assert the status code."""
        response = self.request(method, url, **kwargs)
        assert response.status_code == expected, (
            f"Expected status {expected}, got {response.status_code}. "
            f"Response body: {response.text[:500]}"
        )
        return response
