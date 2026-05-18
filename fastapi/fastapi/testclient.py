import base64
from typing import Any, Dict, Iterator, Optional
from starlette.testclient import TestClient as StarletteTestClient, WebSocketTestSession


class FastAPITestClient(StarletteTestClient):
    """
    Enhanced TestClient for FastAPI with authentication helpers
    and WebSocket convenience methods.

    Usage:
        client = FastAPITestClient(app)
        client.authenticate("my-token")
        response = client.get("/items")
    """

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._auth_headers: Dict[str, str] = {}

    # ------------------------------------------------------------------
    # Authentication
    # ------------------------------------------------------------------

    def authenticate(self, token: str) -> None:
        """Set Bearer token for all subsequent requests.

        Calling authenticate again replaces the previous token.
        """
        self._auth_headers["Authorization"] = f"Bearer {token}"

    def authenticate_basic(self, username: str, password: str) -> None:
        """Set HTTP Basic auth for all subsequent requests.

        Credentials are base64-encoded automatically.
        """
        raw = f"{username}:{password}"
        encoded = base64.b64encode(raw.encode()).decode()
        self._auth_headers["Authorization"] = f"Basic {encoded}"

    def reset_auth(self) -> None:
        """Clear all authentication state."""
        self._auth_headers.clear()

    # ------------------------------------------------------------------
    # Request helpers
    # ------------------------------------------------------------------

    def assert_status(
        self,
        method: str,
        path: str,
        expected_status: int,
        **request_kwargs: Any,
    ) -> "FastAPITestClient":
        """Make a request and assert the status code in one call.

        Raises AssertionError with a helpful message if the status
        does not match.

        Example:
            client.assert_status("GET", "/items", 200)
            client.assert_status("POST", "/items", 201, json={"name": "foo"})
        """
        headers = request_kwargs.pop("headers", {})
        merged_headers = {**self._auth_headers, **headers}
        response = self.request(method, path, headers=merged_headers, **request_kwargs)

        if response.status_code != expected_status:
            raise AssertionError(
                f"Expected status {expected_status}, got {response.status_code} "
                f"for {method.upper()} {path}. "
                f"Response body: {response.text[:200]}"
            )

        return self

    # ------------------------------------------------------------------
    # WebSocket
    # ------------------------------------------------------------------

    def ws_connect(
        self,
        path: str,
        headers: Optional[Dict[str, str]] = None,
        subprotocols: Optional[list[str]] = None,
    ) -> WebSocketTestSession:
        """Open a WebSocket connection with custom headers and subprotocols.

        Returns a WebSocketTestSession context manager.

        Example:
            with client.ws_connect("/ws", headers={"X-Custom": "val"}) as ws:
                ws.send_json({"msg": "hello"})
                data = ws.receive_json()
        """
        merged: Dict[str, Any] = {}
        if headers:
            merged["headers"] = [(k, v) for k, v in headers.items()]
        if subprotocols:
            merged["subprotocols"] = subprotocols

        return super().websocket_connect(path, **merged)

    # ------------------------------------------------------------------
    # Override request to inject auth headers automatically
    # ------------------------------------------------------------------

    def request(self, method: str, url: str, **kwargs: Any) -> Any:
        headers = kwargs.pop("headers", {})
        merged = {**self._auth_headers, **headers}
        return super().request(method, url, headers=merged, **kwargs)

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

    def options(self, url: str, **kwargs: Any) -> Any:
        return self.request("OPTIONS", url, **kwargs)

    def head(self, url: str, **kwargs: Any) -> Any:
        return self.request("HEAD", url, **kwargs)
