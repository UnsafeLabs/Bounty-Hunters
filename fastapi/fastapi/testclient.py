from starlette.testclient import TestClient as TestClient  # noqa

import base64
from typing import Any

from starlette.testclient import TestClient as _TestClient


class FastAPITestClient(_TestClient):
    """Extends Starlette's TestClient with authentication helpers,
    WebSocket convenience, and status assertion methods.
    """

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._auth_headers: dict[str, str] = {}

    def authenticate(self, token: str) -> None:
        """Set a Bearer token for all subsequent requests.

        Calling again replaces the previous token.
        """
        self._auth_headers["Authorization"] = f"Bearer {token}"

    def authenticate_basic(self, username: str, password: str) -> None:
        """Set Basic auth credentials for all subsequent requests.

        Encodes ``username:password`` with Base64 and sets the
        ``Authorization`` header.
        """
        raw = f"{username}:{password}"
        encoded = base64.b64encode(raw.encode()).decode()
        self._auth_headers["Authorization"] = f"Basic {encoded}"

    def reset_auth(self) -> None:
        """Clear any previously set authentication state."""
        self._auth_headers.clear()

    def request(self, method: str, url: str, **kwargs: Any) -> Any:
        """httpx.Client.request override — injects stored auth headers."""
        if self._auth_headers:
            headers = kwargs.get("headers") or {}
            # Merge: explicit kwargs headers take precedence over auth headers
            merged = dict(self._auth_headers)
            if isinstance(headers, dict):
                merged.update(headers)
            kwargs["headers"] = merged
        return super().request(method, url, **kwargs)

    def ws_connect(
        self,
        url: str,
        headers: dict[str, str] | None = None,
        subprotocols: list[str] | None = None,
    ) -> Any:
        """Convenience wrapper around ``websocket_connect`` that supports
        custom headers and subprotocols directly.
        """
        kwargs: dict[str, Any] = {}
        if headers is not None:
            kwargs["headers"] = headers
        if subprotocols is not None:
            kwargs["subprotocols"] = subprotocols
        return self.websocket_connect(url, **kwargs)

    def assert_status(
        self,
        method: str,
        url: str,
        expected_status: int,
        **kwargs: Any,
    ) -> Any:
        """Make a request and assert the response status code.

        Raises ``AssertionError`` with a helpful message when the
        actual status does not match *expected_status*.

        Returns the response so further assertions can be chained.
        """
        response = self.request(method, url, **kwargs)
        assert response.status_code == expected_status, (
            f"Expected status {expected_status} but got {response.status_code} "
            f"for {method} {url}"
        )
        return response
