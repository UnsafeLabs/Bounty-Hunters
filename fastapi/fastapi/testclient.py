import base64
from typing import Any, Dict, Optional, Union

from starlette.testclient import TestClient as StarletteTestClient


class FastAPITestClient(StarletteTestClient):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._auth_headers: Dict[str, str] = {}

    def authenticate(self, token: str) -> None:
        """Sets a Bearer token for all subsequent requests."""
        self._auth_headers["Authorization"] = f"Bearer {token}"

    def authenticate_basic(self, username: str, password: str) -> None:
        """Sets HTTP Basic auth for all subsequent requests."""
        auth_bytes = f"{username}:{password}".encode("ascii")
        encoded = base64.b64encode(auth_bytes).decode("ascii")
        self._auth_headers["Authorization"] = f"Basic {encoded}"

    def reset_auth(self) -> None:
        """Clears all authentication headers."""
        self._auth_headers.pop("Authorization", None)

    def request(
        self,
        method: str,
        url: str,
        *,
        headers: Optional[Dict[str, str]] = None,
        **kwargs: Any,
    ) -> Any:
        # Merge auth headers with provided headers
        new_headers = {**self._auth_headers}
        if headers:
            new_headers.update(headers)
        return super().request(method, url, headers=new_headers, **kwargs)

    def assert_status(self, response: Any, expected_status: int) -> None:
        """Asserts the status code and provides a helpful error message on failure."""
        if response.status_code != expected_status:
            raise AssertionError(
                f"Expected status {expected_status}, but got {response.status_code}. "
                f"Response body: {response.text}"
            )

    def ws_connect(
        self,
        url: str,
        *,
        headers: Optional[Dict[str, str]] = None,
        **kwargs: Any,
    ) -> Any:
        """Creates a WebSocket connection with merged auth headers."""
        new_headers = {**self._auth_headers}
        if headers:
            new_headers.update(headers)
        return super().websocket_connect(url, headers=new_headers, **kwargs)


# Maintain backward compatibility
TestClient = FastAPITestClient
