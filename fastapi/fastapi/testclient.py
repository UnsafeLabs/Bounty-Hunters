from __future__ import annotations

from base64 import b64encode
from collections.abc import Mapping, Sequence
from typing import Any

from httpx import Response
from starlette.testclient import TestClient as TestClient  # noqa
from starlette.testclient import WebSocketTestSession


class FastAPITestClient(TestClient):
    def authenticate(self, token: str) -> "FastAPITestClient":
        self.headers["authorization"] = f"Bearer {token}"
        return self

    def authenticate_basic(
        self, username: str, password: str
    ) -> "FastAPITestClient":
        credentials = f"{username}:{password}".encode("utf-8")
        encoded_credentials = b64encode(credentials).decode("ascii")
        self.headers["authorization"] = f"Basic {encoded_credentials}"
        return self

    def reset_auth(self) -> "FastAPITestClient":
        if "authorization" in self.headers:
            del self.headers["authorization"]
        return self

    def ws_connect(
        self,
        url: str,
        *,
        headers: Mapping[str, str] | None = None,
        subprotocols: Sequence[str] | None = None,
        **kwargs: Any,
    ) -> WebSocketTestSession:
        return self.websocket_connect(
            url,
            subprotocols=subprotocols,
            headers=dict(headers or {}),
            **kwargs,
        )

    def assert_status(
        self, method: str, url: str, expected_status: int, **kwargs: Any
    ) -> Response:
        response = self.request(method, url, **kwargs)
        if response.status_code != expected_status:
            raise AssertionError(
                f"Expected {expected_status} for {method.upper()} {url}, "
                f"got {response.status_code}: {response.text}"
            )
        return response
