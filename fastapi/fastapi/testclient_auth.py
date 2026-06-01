"""
Enhanced TestClient with auth helpers and WebSocket support.
"""
from typing import Optional, Dict, Any, Callable
from fastapi.testclient import TestClient
import json


class AuthTestClient:
    """
    TestClient wrapper with authentication helpers.

    Usage:
        client = AuthTestClient(app, base_url="http://test")
        client.set_api_key("test-key-123")
        response = client.get("/protected")
    """

    def __init__(self, app, base_url: str = "http://test", **kwargs):
        self.client = TestClient(app, base_url=base_url, **kwargs)
        self._api_key: Optional[str] = None
        self._bearer_token: Optional[str] = None
        self._basic_auth: Optional[tuple] = None
        self._custom_headers: Dict[str, str] = {}

    def set_api_key(self, key: str, header_name: str = "X-API-Key") -> None:
        """Set API key for authentication."""
        self._api_key = key
        self._custom_headers[header_name] = key

    def set_bearer_token(self, token: str) -> None:
        """Set Bearer token for authentication."""
        self._bearer_token = token
        self._custom_headers["Authorization"] = f"Bearer {token}"

    def set_basic_auth(self, username: str, password: str) -> None:
        """Set Basic authentication."""
        self._basic_auth = (username, password)
        import base64
        credentials = base64.b64encode(f"{username}:{password}".encode()).decode()
        self._custom_headers["Authorization"] = f"Basic {credentials}"

    def set_custom_header(self, name: str, value: str) -> None:
        """Set custom header."""
        self._custom_headers[name] = value

    def clear_auth(self) -> None:
        """Clear all authentication."""
        self._api_key = None
        self._bearer_token = None
        self._basic_auth = None
        self._custom_headers = {}

    def _merge_headers(self, kwargs: dict) -> dict:
        """Merge auth headers with request headers."""
        headers = {**self._custom_headers}
        if "headers" in kwargs:
            headers.update(kwargs["headers"])
        kwargs["headers"] = headers
        return kwargs

    def get(self, url: str, **kwargs) -> Any:
        return self.client.get(url, **self._merge_headers(kwargs))

    def post(self, url: str, **kwargs) -> Any:
        return self.client.post(url, **self._merge_headers(kwargs))

    def put(self, url: str, **kwargs) -> Any:
        return self.client.put(url, **self._merge_headers(kwargs))

    def delete(self, url: str, **kwargs) -> Any:
        return self.client.delete(url, **self._merge_headers(kwargs))

    def patch(self, url: str, **kwargs) -> Any:
        return self.client.patch(url, **self._merge_headers(kwargs))

    def websocket_connect(
        self,
        url: str,
        subprotocols: list = None,
        **kwargs,
    ):
        """
        Connect to WebSocket with auth headers.

        Usage:
            with client.websocket_connect("/ws") as ws:
                ws.send_json({"message": "hello"})
                data = ws.receive_json()
        """
        headers = {**self._custom_headers}
        if "headers" in kwargs:
            headers.update(kwargs["headers"])

        return self.client.websocket_connect(
            url,
            subprotocols=subprotocols,
            headers=headers,
        )


def create_test_client(app, **kwargs) -> AuthTestClient:
    """Factory function to create an authenticated test client."""
    return AuthTestClient(app, **kwargs)
