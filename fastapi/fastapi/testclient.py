from base64 import b64encode
from typing import Any

from starlette.testclient import TestClient as TestClient  # noqa
from starlette.testclient import WebSocketTestSession


class FastAPITestClient(TestClient):
    def authenticate(self, token: str) -> "FastAPITestClient":
        self.headers["Authorization"] = f"Bearer {token}"
        return self

    def authenticate_basic(self, username: str, password: str) -> "FastAPITestClient":
        credentials = f"{username}:{password}".encode()
        token = b64encode(credentials).decode("ascii")
        self.headers["Authorization"] = f"Basic {token}"
        return self

    def reset_auth(self) -> "FastAPITestClient":
        self.headers.pop("Authorization", None)
        return self

    def ws_connect(
        self,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        subprotocols: list[str] | None = None,
        **kwargs: Any,
    ) -> WebSocketTestSession:
        websocket_headers = dict(self.headers)
        if headers is not None:
            websocket_headers.update(headers)
        return self.websocket_connect(
            url,
            subprotocols=subprotocols,
            headers=websocket_headers,
            **kwargs,
        )

    def assert_status(
        self,
        method: str,
        url: str,
        expected_status_code: int,
        **kwargs: Any,
    ):
        response = self.request(method, url, **kwargs)
        assert response.status_code == expected_status_code, (
            f"Expected status code {expected_status_code}, "
            f"got {response.status_code}: {response.text}"
        )
        return response
