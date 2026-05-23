from base64 import b64encode
from collections.abc import AsyncGenerator
from typing import Any
from urllib.parse import urlencode

from starlette.testclient import TestClient as TestClient  # noqa
from starlette.websockets import WebSocketDisconnect


class FastAPITestClient(TestClient):
    def __init__(self, app: Any, *args: Any, **kwargs: Any):
        super().__init__(app, *args, **kwargs)
        self._auth_token: str | None = None

    def authenticate(self, token: str) -> None:
        self._auth_token = token

    def authenticate_basic(self, username: str, password: str) -> None:
        credentials = b64encode(f"{username}:{password}".encode()).decode()
        self._auth_token = f"Basic {credentials}"

    def reset_auth(self) -> None:
        self._auth_token = None

    def _add_auth(self, kwargs: dict[str, Any]) -> dict[str, Any]:
        if self._auth_token:
            headers = kwargs.get("headers", {})
            headers["Authorization"] = self._auth_token
            kwargs["headers"] = headers
        return kwargs

    def request(self, method: str, url: str, **kwargs: Any) -> Any:
        return super().request(method, url, **self._add_auth(kwargs))

    def ws_connect(self, url: str, **kwargs: Any) -> Any:
        return super().ws_connect(url, **self._add_auth(kwargs))

    def assert_status(self, method: str, url: str, expected: int, **kwargs: Any) -> Any:
        response = self.request(method, url, **kwargs)
        assert response.status_code == expected, (
            f"Expected status {expected}, got {response.status_code}: {response.content}"
        )
        return response
