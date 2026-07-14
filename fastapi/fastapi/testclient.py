import base64
from contextlib import contextmanager
from typing import Any

from starlette.testclient import TestClient as _TestClient  # noqa
from starlette.testclient import TestClient as TestClient  # noqa


class FastAPITestClient(_TestClient):
    """Extended TestClient with auth helpers and WebSocket convenience methods.

    Provides authenticate, authenticate_basic, ws_connect, and assert_status
    methods for streamlined testing of FastAPI applications.
    """

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._auth_header: str | None = None

    def authenticate(self, token: str) -> None:
        """Set Bearer token for all subsequent requests."""
        self._auth_header = f"Bearer {token}"

    def authenticate_basic(self, username: str, password: str) -> None:
        """Set HTTP Basic auth header for all subsequent requests."""
        encoded = base64.b64encode(f"{username}:{password}".encode()).decode()
        self._auth_header = f"Basic {encoded}"

    def reset_auth(self) -> None:
        """Clear any previously set authentication."""
        self._auth_header = None

    @contextmanager
    def ws_connect(
        self,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        subprotocols: list[str] | None = None,
        **kwargs: Any,
    ):
        """Connect to a WebSocket with custom headers and subprotocols.

        Returns a context manager yielding the WebSocket session.
        """
        merged_headers: dict[str, str] = {}
        if self._auth_header is not None:
            merged_headers["Authorization"] = self._auth_header
        if headers:
            merged_headers.update(headers)

        yield self.websocket_connect(url, headers=merged_headers, subprotocols=subprotocols, **kwargs)

    def assert_status(
        self,
        method: str,
        url: str,
        expected_status: int,
        **kwargs: Any,
    ) -> Any:
        """Make a request and assert the status code.

        Raises AssertionError with a descriptive message on mismatch.

        Returns the response for further assertions.
        """
        resp = self.request(method, url, **kwargs)
        assert resp.status_code == expected_status, (
            f"Expected status {expected_status}, got {resp.status_code}. "
            f"Response body: {resp.text[:500]}"
        )
        return resp

    def request(  # type: ignore[override]
        self,
        method: str,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        **kwargs: Any,
    ) -> Any:
        """Override request to inject auth header automatically."""
        merged_headers: dict[str, str] = dict(headers or {})
        if self._auth_header is not None and "Authorization" not in merged_headers:
            merged_headers["Authorization"] = self._auth_header
        return super().request(method, url, headers=merged_headers, **kwargs)
