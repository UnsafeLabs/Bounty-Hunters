import base64
from typing import Any, Generator
from contextlib import contextmanager

from starlette.testclient import TestClient as StarletteTestClient
from starlette.websockets import WebSocket


class FastAPITestClient(StarletteTestClient):
    """TestClient with authentication helpers and WebSocket convenience methods."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._auth_token: str | None = None
        self._basic_auth: str | None = None

    def authenticate(self, token: str) -> "FastAPITestClient":
        """Set Bearer token for all subsequent requests."""
        self._auth_token = f"Bearer {token}"
        self._basic_auth = None
        return self

    def authenticate_basic(self, username: str, password: str) -> "FastAPITestClient":
        """Set HTTP Basic auth for all subsequent requests."""
        credentials = base64.b64encode(f"{username}:{password}".encode()).decode()
        self._basic_auth = f"Basic {credentials}"
        self._auth_token = None
        return self

    def reset_auth(self) -> "FastAPITestClient":
        """Clear authentication state."""
        self._auth_token = None
        self._basic_auth = None
        return self

    def _get_auth_headers(self) -> dict[str, str]:
        headers: dict[str, str] = {}
        if self._auth_token:
            headers["Authorization"] = self._auth_token
        elif self._basic_auth:
            headers["Authorization"] = self._basic_auth
        return headers

    def request(self, method: str, url: str, **kwargs: Any) -> Any:
        """Override request to inject auth headers."""
        headers = kwargs.pop("headers", {}) or {}
        auth_headers = self._get_auth_headers()
        auth_headers.update(headers)
        return super().request(method, url, headers=auth_headers, **kwargs)

    @contextmanager
    def ws_connect(
        self,
        url: str,
        headers: dict[str, str] | None = None,
        subprotocols: list[str] | None = None,
    ) -> Generator[WebSocket, None, None]:
        """Create a WebSocket connection with custom headers and subprotocols."""
        ws_headers = self._get_auth_headers()
        if headers:
            ws_headers.update(headers)
        with self.websocket_connect(url, headers=ws_headers, subprotocols=subprotocols) as ws:
            yield ws

    def assert_status(
        self, method: str, url: str, expected_status: int, **kwargs: Any
    ) -> Any:
        """Make a request and assert the status code."""
        response = self.request(method, url, **kwargs)
        assert response.status_code == expected_status, (
            f"Expected status {expected_status}, got {response.status_code}. "
            f"Response: {response.text[:500]}"
        )
        return response
