import base64
from typing import Any

from starlette.testclient import TestClient as TestClient  # noqa
from starlette.testclient import WebSocketTestSession


class FastAPITestClient(TestClient):
    """Extended TestClient with authentication helpers and WebSocket convenience methods."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._auth_headers: dict[str, str] = {}

    def _apply_auth_headers(self, kwargs: dict[str, Any]) -> dict[str, Any]:
        """Merge stored auth headers into the request headers."""
        if self._auth_headers:
            headers = kwargs.pop("headers", {}) or {}
            headers = {**self._auth_headers, **headers}
            kwargs["headers"] = headers
        return kwargs

    def authenticate(self, token: str) -> None:
        """Add a Bearer token to all subsequent requests.

        Args:
            token: The OAuth2 / Bearer token string to include in the
                Authorization header.
        """
        self._auth_headers["Authorization"] = f"Bearer {token}"

    def authenticate_basic(self, username: str, password: str) -> None:
        """Add HTTP Basic authentication to all subsequent requests.

        Args:
            username: The username for basic auth.
            password: The password for basic auth.
        """
        credentials = f"{username}:{password}"
        encoded = base64.b64encode(credentials.encode()).decode()
        self._auth_headers["Authorization"] = f"Basic {encoded}"

    def reset_auth(self) -> None:
        """Remove all authentication headers, reverting to unauthenticated
        requests."""
        self._auth_headers.clear()

    def ws_connect(
        self,
        url: str,
        subprotocols: list[str] | None = None,
        headers: dict[str, str] | None = None,
        **kwargs: Any,
    ) -> WebSocketTestSession:
        """Open a WebSocket connection with optional custom headers.

        This is a thin wrapper around ``websocket_connect`` that merges any
        stored auth headers and the caller-supplied ``headers`` dict so that
        websocket upgrades carry the expected authentication.

        Args:
            url: The WebSocket endpoint path (e.g. ``/ws``).
            subprotocols: Optional list of subprotocols to negotiate.
            headers: Extra HTTP headers to send during the upgrade handshake.

        Returns:
            A context-manager-aware ``WebSocketTestSession`` instance.
        """
        # Merge auth headers into the request
        merged_headers = dict(self._auth_headers)
        if headers:
            merged_headers.update(headers)
        kwargs["headers"] = merged_headers
        return self.websocket_connect(url, subprotocols=subprotocols, **kwargs)

    def assert_status(
        self,
        expected_status: int,
        method: str,
        url: str,
        **kwargs: Any,
    ) -> Any:
        """Make a request and assert the response status code in one call.

        Args:
            expected_status: The expected HTTP status code.
            method: HTTP method (``"GET"``, ``"POST"``, etc.).
            url: The request URL path.
            **kwargs: Additional arguments passed to the underlying request
                method (``headers``, ``json``, ``data``, etc.).

        Returns:
            The response object so callers can further inspect it.

        Raises:
            AssertionError: If the response status code does not match.
        """
        kwargs = self._apply_auth_headers(kwargs)
        response = self.request(method, url, **kwargs)
        assert response.status_code == expected_status, (
            f"Expected status {expected_status}, got {response.status_code}: "
            f"{response.text}"
        )
        return response

    def request(self, method: str, url: str, **kwargs: Any) -> Any:
        kwargs = self._apply_auth_headers(kwargs)
        return super().request(method, url, **kwargs)
