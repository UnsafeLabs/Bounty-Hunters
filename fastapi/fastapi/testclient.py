from starlette.testclient import TestClient as TestClient  # noqa

import base64
from contextlib import contextmanager
from typing import Any
from starlette.types import ASGIApp


class FastAPITestClient(TestClient):
    def __init__(self, app: ASGIApp, **kwargs: Any):
        super().__init__(app, **kwargs)
        self._auth_headers: dict[str, str] = {}

    def authenticate(self, token: str) -> None:
        self._auth_headers["Authorization"] = f"Bearer {token}"

    def authenticate_basic(self, username: str, password: str) -> None:
        credentials = base64.b64encode(f"{username}:{password}".encode()).decode()
        self._auth_headers["Authorization"] = f"Basic {credentials}"

    def reset_auth(self) -> None:
        self._auth_headers.clear()

    @contextmanager
    def ws_connect(self, path: str, headers: dict[str, str] | None = None, subprotocols: list[str] | None = None):
        merged_headers = dict(self._auth_headers)
        if headers:
            merged_headers.update(headers)
        with self.websocket_connect(path, headers=merged_headers, subprotocols=subprotocols) as ws:
            yield ws

    def assert_status(self, method: str, path: str, expected_status: int, **kwargs: Any) -> Any:
        kwargs.setdefault("headers", {})
        kwargs["headers"].update(self._auth_headers)
        response = self.request(method, path, **kwargs)
        assert response.status_code == expected_status, (
            f"Expected status {expected_status}, got {response.status_code}. "
            f"Response: {response.text[:200]}"
        )
        return response

    def request(self, method: str, url: str, **kwargs: Any) -> Any:
        kwargs.setdefault("headers", {})
        kwargs["headers"].update(self._auth_headers)
        return super().request(method, url, **kwargs)
