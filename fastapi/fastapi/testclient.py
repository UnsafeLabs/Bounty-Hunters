import base64
from collections.abc import Sequence
from typing import Any

from httpx import Response
from starlette.testclient import TestClient as TestClient  # noqa


class FastAPITestClient(TestClient):
    def authenticate(self, token: str) -> "FastAPITestClient":
        self.headers["Authorization"] = f"Bearer {token}"
        return self

    def authenticate_basic(
        self, username: str, password: str
    ) -> "FastAPITestClient":
        credentials = base64.b64encode(f"{username}:{password}".encode()).decode()
        self.headers["Authorization"] = f"Basic {credentials}"
        return self

    def reset_auth(self) -> "FastAPITestClient":
        self.headers.pop("Authorization", None)
        return self

    def ws_connect(
        self,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        subprotocols: Sequence[str] | None = None,
        **kwargs: Any,
    ):
        return self.websocket_connect(
            url,
            headers=headers,
            subprotocols=subprotocols,
            **kwargs,
        )

    def assert_status(
        self,
        method: str,
        url: str,
        expected_status: int,
        **kwargs: Any,
    ) -> Response:
        response = self.request(method, url, **kwargs)
        if response.status_code != expected_status:
            raise AssertionError(
                f"Expected status {expected_status}, got {response.status_code}: "
                f"{response.text}"
            )
        return response
