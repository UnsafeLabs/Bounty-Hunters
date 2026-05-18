from starlette.testclient import TestClient as TestClient  # noqa
from starlette.testclient import TestClient as StarletteTestClient
from starlette.websockets import WebSocket
from typing import Optional, List, Any, Dict
import base64


class FastAPITestClient(StarletteTestClient):
    """
    Extended TestClient with authentication helpers and WebSocket convenience methods.

    Adds authenticate(), authenticate_basic(), ws_connect(), assert_status(),
    and reset_auth() methods on top of the standard Starlette TestClient.
    """

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._auth_token: Optional[str] = None
        self._auth_basic: Optional[str] = None

    def authenticate(self, token: str) -> None:
        """
        Set Bearer token for all subsequent requests.

        Calling again replaces the previous token.
        """
        self._auth_token = token
        self._auth_basic = None
        self.headers["Authorization"] = f"Bearer {token}"

    def authenticate_basic(self, username: str, password: str) -> None:
        """
        Set HTTP Basic auth for all subsequent requests.

        Base64 encodes the credentials and sets the Authorization header.
        """
        credentials = base64.b64encode(f"{username}:{password}".encode()).decode()
        self._auth_basic = credentials
        self._auth_token = None
        self.headers["Authorization"] = f"Basic {credentials}"

    def reset_auth(self) -> None:
        """
        Clear all authentication state.
        """
        self._auth_token = None
        self._auth_basic = None
        self.headers.pop("Authorization", None)

    def ws_connect(
        self,
        path: str,
        headers: Optional[Dict[str, str]] = None,
        subprotocols: Optional[List[str]] = None,
    ):
        """
        Create a WebSocket connection with custom headers.

        Returns a context manager for the WebSocket connection.
        """
        all_headers = dict(self.headers)
        if headers:
            all_headers.update(headers)
        return super().ws_connect(path, headers=all_headers, subprotocols=subprotocols)

    def assert_status(self, method: str, path: str, expected_status: int, **kwargs: Any) -> None:
        """
        Make a request and assert the status code.

        Raises AssertionError with helpful message if status doesn't match.
        """
        response = getattr(self, method.lower())(path, **kwargs)
        if response.status_code != expected_status:
            raise AssertionError(
                f"Expected status {expected_status}, got {response.status_code}. "
                f"Response: {response.text[:200]}"
            )
