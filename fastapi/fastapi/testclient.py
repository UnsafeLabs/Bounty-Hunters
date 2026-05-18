from __future__ import annotations

import base64
from contextlib import contextmanager
from typing import Any, Generator

from starlette.testclient import TestClient as TestClient  # noqa


class FastAPITestClient(TestClient):
    """Extended TestClient with auth helpers and WebSocket convenience methods."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._auth_token: str | None = None
        self._auth_headers: dict[str, str] = {}

    def authenticate(self, token: str) -> FastAPITestClient:
        """Set Bearer token for all subsequent requests.

        Args:
            token: The authentication token string.

        Returns:
            self: For method chaining.
        """
        self._auth_token = token
        self._auth_headers["Authorization"] = f"Bearer {token}"
        return self

    def authenticate_basic(self, username: str, password: str) -> FastAPITestClient:
        """Set HTTP Basic auth for all subsequent requests.

        Args:
            username: The username for basic auth.
            password: The password for basic auth.

        Returns:
            self: For method chaining.
        """
        credentials = base64.b64encode(f"{username}:{password}".encode()).decode()
        self._auth_headers["Authorization"] = f"Basic {credentials}"
        return self

    def reset_auth(self) -> FastAPITestClient:
        """Clear authentication state.

        Returns:
            self: For method chaining.
        """
        self._auth_token = None
        self._auth_headers = {}
        return self

    def request(self, method: str, url: str, **kwargs: Any) -> Any:
        """Override request to inject auth headers."""
        headers = kwargs.pop("headers", {})
        if self._auth_headers:
            merged_headers = {**self._auth_headers, **headers}
            kwargs["headers"] = merged_headers
        else:
            kwargs["headers"] = headers
        return super().request(method, url, **kwargs)

    def assert_status(self, method: str, url: str, expected_status: int, **kwargs: Any) -> Any:
        """Make a request and assert the status code.

        Args:
            method: HTTP method (GET, POST, etc.)
            url: The URL to request.
            expected_status: Expected HTTP status code.
            **kwargs: Additional arguments passed to request.

        Returns:
            The response object.

        Raises:
            AssertionError: If status code doesn't match.
        """
        response = self.request(method, url, **kwargs)
        assert response.status_code == expected_status, (
            f"Expected status {expected_status}, got {response.status_code}. "
            f"URL: {method} {url}, Response: {response.text[:200]}"
        )
        return response

    @contextmanager
    def ws_connect(
        self,
        url: str,
        subprotocols: list[str] | None = None,
        **kwargs: Any,
    ) -> Generator[Any, None, None]:
        """Create a WebSocket connection with custom headers.

        Args:
            url: The WebSocket URL to connect to.
            subprotocols: Optional list of WebSocket subprotocols.
            **kwargs: Additional arguments passed to websocket_connect.

        Yields:
            The WebSocket connection.
        """
        headers = dict(self._auth_headers) if self._auth_headers else {}
        extra_headers = kwargs.pop("extra_headers", {})
        headers.update(extra_headers)

        with super().websocket_connect(
            url,
            subprotocols=subprotocols,
            headers=headers,
            **kwargs,
        ) as ws:
            yield ws
