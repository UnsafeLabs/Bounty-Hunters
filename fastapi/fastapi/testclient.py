import base64
from collections.abc import Sequence
from typing import Any

import httpx
from starlette.testclient import TestClient as TestClient  # noqa


class FastAPITestClient(TestClient):
    def authenticate(self, token: str) -> "FastAPITestClient":
        self.headers["Authorization"] = f"Bearer {token}"
        return self

    def authenticate_basic(
        self,
        username: str,
        password: str,
    ) -> "FastAPITestClient":
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
        *,
        headers: Any | None = None,
        subprotocols: Sequence[str] | None = None,
        **kwargs: Any,
    ) -> Any:
        merged_headers = httpx.Headers(self.headers)
        if headers is not None:
            merged_headers.update(headers)
        return self.websocket_connect(
            url,
            subprotocols=subprotocols,
            headers=dict(merged_headers),
            **kwargs,
        )

    def assert_status(
        self,
        method: str,
        url: Any,
        expected_status: int | None = None,
        *,
        status_code: int | None = None,
        **kwargs: Any,
    ) -> httpx.Response:
        if expected_status is None:
            if status_code is None:
                raise TypeError("expected_status is required")
            expected_status = status_code
        elif status_code is not None:
            raise TypeError("pass either expected_status or status_code, not both")

        response = self.request(method, url, **kwargs)
        if response.status_code != expected_status:
            raise AssertionError(
                f"Expected status code {expected_status} for {method.upper()} {url}; "
                f"actual status code {response.status_code}. Response body: {response.text}"
            )
        return response
