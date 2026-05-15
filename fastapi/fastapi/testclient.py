from starlette.testclient import TestClient as TestClient  
from typing import Optional, Dict, Any
import base64


class FastAPITestClient(TestClient):
    """
    Extended test client for FastAPI with authentication helpers
    and WebSocket convenience methods.
    """

    def __init__(self, app: Any, **kwargs: Any) -> None:
        super().__init__(app, **kwargs)
        self._token: Optional[str] = None
        self._custom_headers: Dict[str, str] = {}

    def authenticate(self, token: str) -> None:
        """
        Set a Bearer token that will be included in all subsequent requests.
        """
        self._token = token
        self._custom_headers["Authorization"] = f"Bearer {token}"

    def authenticate_basic(self, username: str, password: str) -> None:
        """
        Set HTTP Basic auth credentials that will be included in all subsequent requests.
        """
        encoded = base64.b64encode(f"{username}:{password}".encode()).decode()
        self._custom_headers["Authorization"] = f"Basic {encoded}"

    def ws_connect(self, url: str, **kwargs: Any):
        """
        Open a WebSocket connection, automatically attaching any custom headers
        (e.g. Authorization) that were set via authenticate() or authenticate_basic().
        """
        headers = kwargs.pop("headers", {})
        if self._custom_headers:
            headers.update(self._custom_headers)
        kwargs["headers"] = headers
        return super().ws_connect(url, **kwargs)

    # Internal: inject custom headers into every HTTP request
    def _send_request(self, method: str, url: str, **kwargs: Any) -> Any:
        headers = kwargs.pop("headers", {})
        if self._custom_headers:
            headers.update(self._custom_headers)
        kwargs["headers"] = headers
        # Starlette TestClient uses requests.Session under the hood;
        # we override request() to inject headers automatically.
        return super().request(method, url, **kwargs)

    def request(self, method: str, url: str, **kwargs: Any) -> Any:
        headers = kwargs.get("headers", {})
        if self._custom_headers:
            for k, v in self._custom_headers.items():
                if k not in headers:
                    headers[k] = v
            kwargs["headers"] = headers
        return super().request(method, url, **kwargs)
