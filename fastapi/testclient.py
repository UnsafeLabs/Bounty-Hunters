"""
FastAPITestClient - Extended TestClient with auth helpers and WebSocket convenience methods
Bounty: $200 (UnsafeLabs/Bounty-Hunters #804)
"""
import base64
from typing import Any, Optional, Union
from contextlib import contextmanager

try:
    from starlette.testclient import TestClient as StarletteTestClient
    from starlette.websockets import WebSocket
except ImportError:
    raise ImportError("starlette is required: pip install starlette")

try:
    import httpx
except ImportError:
    raise ImportError("httpx is required: pip install httpx")


class FastAPITestClient(StarletteTestClient):
    """
    Extended TestClient with authentication helpers and WebSocket convenience methods.
    
    Usage:
        client = FastAPITestClient(app)
        client.authenticate("my-jwt-token")
        response = client.get("/protected-endpoint")
        
        # Basic auth
        client.authenticate_basic("user", "pass")
        response = client.get("/basic-auth-endpoint")
        
        # WebSocket with auth
        with client.ws_connect("/ws", headers={"Authorization": "Bearer token"}) as ws:
            ws.send_json({"action": "ping"})
            data = ws.receive_json()
        
        # Assert status in one call
        client.assert_status("GET", "/api/health", expected_status=200)
        
        # Reset auth
        client.reset_auth()
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._auth_token: Optional[str] = None
        self._auth_type: str = "Bearer"
        self._basic_credentials: Optional[str] = None

    def authenticate(self, token: str) -> "FastAPITestClient":
        """
        Set Bearer token authentication for all subsequent requests.
        
        Args:
            token: JWT or API token string
            
        Returns:
            self for chaining
        """
        self._auth_token = token
        self._auth_type = "Bearer"
        self._basic_credentials = None
        return self

    def authenticate_basic(self, username: str, password: str) -> "FastAPITestClient":
        """
        Set HTTP Basic authentication for all subsequent requests.
        
        Args:
            username: HTTP basic auth username
            password: HTTP basic auth password
            
        Returns:
            self for chaining
        """
        credentials = base64.b64encode(f"{username}:{password}".encode()).decode()
        self._basic_credentials = credentials
        self._auth_type = "Basic"
        self._auth_token = None
        return self

    def reset_auth(self) -> "FastAPITestClient":
        """
        Clear all authentication state.
        
        Returns:
            self for chaining
        """
        self._auth_token = None
        self._auth_type = "Bearer"
        self._basic_credentials = None
        return self

    def _get_auth_headers(self) -> dict:
        """Get authentication headers based on current auth state."""
        headers = {}
        if self._basic_credentials:
            headers["Authorization"] = f"Basic {self._basic_credentials}"
        elif self._auth_token:
            headers["Authorization"] = f"{self._auth_type} {self._auth_token}"
        return headers

    def request(self, method: str, url: str, **kwargs) -> httpx.Response:
        """
        Override request method to inject authentication headers.
        """
        headers = kwargs.pop("headers", None) or {}
        auth_headers = self._get_auth_headers()
        auth_headers.update(headers)
        kwargs["headers"] = auth_headers
        return super().request(method, url, **kwargs)

    def ws_connect(
        self,
        url: str,
        headers: Optional[dict] = None,
        subprotocols: Optional[list] = None,
        **kwargs,
    ) -> "WebSocketContextManager":
        """
        Create a WebSocket connection with custom headers and subprotocols.
        
        Args:
            url: WebSocket URL path (e.g., "/ws")
            headers: Additional headers (auth headers are auto-included)
            subprotocols: List of subprotocols
            
        Returns:
            Context manager that yields a WebSocket-like object
        """
        ws_headers = self._get_auth_headers()
        if headers:
            ws_headers.update(headers)
        
        return WebSocketContextManager(
            client=self,
            url=url,
            headers=ws_headers,
            subprotocols=subprotocols,
            **kwargs,
        )

    def assert_status(
        self,
        method: str,
        url: str,
        expected_status: int,
        **kwargs,
    ) -> httpx.Response:
        """
        Make a request and assert the status code.
        
        Args:
            method: HTTP method (GET, POST, etc.)
            url: Request URL
            expected_status: Expected HTTP status code
            **kwargs: Additional arguments passed to request()
            
        Returns:
            Response object if assertion passes
            
        Raises:
            AssertionError: If status code doesn't match expected
        """
        response = self.request(method, url, **kwargs)
        if response.status_code != expected_status:
            raise AssertionError(
                f"Expected status {expected_status}, got {response.status_code}\n"
                f"URL: {method} {url}\n"
                f"Response body: {response.text[:500]}"
            )
        return response


class WebSocketContextManager:
    """Context manager for WebSocket connections with auth support."""

    def __init__(self, client, url, headers=None, subprotocols=None, **kwargs):
        self.client = client
        self.url = url
        self.headers = headers or {}
        self.subprotocols = subprotocols or []
        self.kwargs = kwargs
        self._ws = None

    def __enter__(self):
        # Build the full URL
        base_url = str(self.client.base_url)
        if base_url.endswith("/") and self.url.startswith("/"):
            full_url = base_url[:-1] + self.url
        elif not base_url.endswith("/") and not self.url.startswith("/"):
            full_url = base_url + "/" + self.url
        else:
            full_url = base_url + self.url
        
        # Convert http(s) to ws(s)
        full_url = full_url.replace("http://", "ws://").replace("https://", "wss://")
        
        # Use starlette's websocket support
        self._ws = self.client.websocket_connect(
            self.url,
            headers=self.headers,
            subprotocols=self.subprotocols,
        )
        self._ws.__enter__()
        return self._ws

    def __exit__(self, *args):
        if self._ws:
            self._ws.__exit__(*args)


# Convenience function for creating a test client
def create_test_client(app, **kwargs) -> FastAPITestClient:
    """Create a FastAPITestClient instance."""
    return FastAPITestClient(app, **kwargs)
