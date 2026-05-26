from __future__ import annotations

import base64
from collections.abc import Mapping, Sequence
from typing import Any

from starlette.testclient import TestClient as TestClient  # noqa


class FastAPITestClient(TestClient):
    def authenticate(self, token: str) -> FastAPITestClient:
        self.headers["Authorization"] = f"Bearer {token}"
        return self

    def authenticate_basic(self, username: str, password: str) -> FastAPITestClient:
        credentials = f"{username}:{password}".encode()
        token = base64.b64encode(credentials).decode("ascii")
        self.headers["Authorization"] = f"Basic {token}"
        return self

    def ws_connect(
        self,
        url: str,
        *,
        headers: Mapping[str, str] | None = None,
        subprotocols: Sequence[str] | None = None,
        **kwargs: Any,
    ) -> Any:
        ws_headers = dict(self.headers)
        if headers:
            ws_headers.update(headers)
        return self.websocket_connect(
            url,
            subprotocols=subprotocols,
            headers=ws_headers,
            **kwargs,
        )

    def assert_status(
        self, method: str, url: str, status_code: int, **kwargs: Any
    ) -> Any:
        response = self.request(method, url, **kwargs)
        assert response.status_code == status_code, (
            f"Expected {status_code} for {method.upper()} {url}, "
            f"got {response.status_code}: {response.text}"
        )
        return response
