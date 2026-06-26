import base64
from collections.abc import Sequence
from typing import Any

import httpx
from starlette.testclient import TestClient as StarletteTestClient
from starlette.testclient import WebSocketTestSession

TestClient = StarletteTestClient


class FastAPITestClient(StarletteTestClient):
    def authenticate(self, token: str) -> "FastAPITestClient":
        self.headers["Authorization"] = f"Bearer {token}"
        return self

    def authenticate_basic(self, username: str, password: str) -> "FastAPITestClient":
        credentials = f"{username}:{password}".encode()
        encoded = base64.b64encode(credentials).decode("ascii")
        self.headers["Authorization"] = f"Basic {encoded}"
        return self

    def reset_auth(self) -> "FastAPITestClient":
        self.headers.pop("Authorization", None)
        return self

    def ws_connect(
        self,
        url: str,
        headers: httpx._types.HeaderTypes | None = None,
        subprotocols: Sequence[str] | None = None,
        **kwargs: Any,
    ) -> WebSocketTestSession:
        merged_headers = httpx.Headers(self.headers)
        kwargs_headers = kwargs.pop("headers", None)
        if kwargs_headers is not None:
            merged_headers.update(kwargs_headers)
        if headers is not None:
            merged_headers.update(headers)
        return self.websocket_connect(
            url,
            subprotocols=subprotocols,
            headers=dict(merged_headers),
            **kwargs,
        )

    def assert_status(
        self, method: str, url: str, expected_status: int, **kwargs: Any
    ) -> httpx.Response:
        response = self.request(method, url, **kwargs)
        if response.status_code != expected_status:
            raise AssertionError(
                f"Expected status {expected_status} for {method} {url}, "
                f"received {response.status_code}: {response.text}"
            )
        return response
