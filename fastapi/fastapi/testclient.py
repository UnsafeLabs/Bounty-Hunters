from typing import Any

from starlette.testclient import TestClient as TestClient  # noqa


class FastAPITestClient(TestClient):
    """Extended TestClient with auth helpers and WebSocket convenience methods."""

    def __init__(self, app: Any, **kwargs: Any) -> None:
        super().__init__(app, **kwargs)
        self._auth_headers: dict[str, str] = {}

    def set_auth_token(self, token: str, scheme: str = "Bearer") -> None:
        """Set the authorization header for subsequent requests."""
        self._auth_headers["Authorization"] = f"{scheme} {token}"

    def clear_auth(self) -> None:
        """Clear the authorization header."""
        self._auth_headers.pop("Authorization", None)

    def request(self, method: str, url: str, **kwargs: Any) -> Any:
        headers = kwargs.pop("headers", {}) or {}
        headers.update(self._auth_headers)
        return super().request(method, url, headers=headers, **kwargs)

    def get(self, url: str, **kwargs: Any) -> Any:
        return self.request("GET", url, **kwargs)

    def post(self, url: str, **kwargs: Any) -> Any:
        return self.request("POST", url, **kwargs)

    def put(self, url: str, **kwargs: Any) -> Any:
        return self.request("PUT", url, **kwargs)

    def patch(self, url: str, **kwargs: Any) -> Any:
        return self.request("PATCH", url, **kwargs)

    def delete(self, url: str, **kwargs: Any) -> Any:
        return self.request("DELETE", url, **kwargs)

    def websocket_connect(
        self, url: str, subprotocols: list[str] | None = None, **kwargs: Any
    ) -> Any:
        """Connect to a WebSocket endpoint with optional auth headers."""
        headers = kwargs.pop("headers", {}) or {}
        headers.update(self._auth_headers)
        return super().websocket_connect(url, subprotocols=subprotocols, headers=headers, **kwargs)
