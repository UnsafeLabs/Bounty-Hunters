from base64 import b64encode
from collections.abc import Sequence
from typing import Any

from starlette.testclient import TestClient as TestClient  # noqa
from starlette.testclient import WebSocketTestSession


class FastAPITestClient(TestClient):
    def authenticate(self, token: str) -> "FastAPITestClient":
        self.headers["Authorization"] = f"Bearer {token}"
        return self

    def authenticate_basic(self, username: str, password: str) -> "FastAPITestClient":
        credentials = f"{username}:{password}".encode("latin-1")
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
        subprotocols: Sequence[str] | None = None,
        **kwargs: Any,
    ) -> WebSocketTestSession:
        if headers is not None:
            kwargs["headers"] = headers
        return self.websocket_connect(
            url,
            subprotocols=subprotocols,
            **kwargs,
        )

    def assert_status(
        self, method: str, url: str, status_code: int, **kwargs: Any
    ) -> Any:
        response = self.request(method, url, **kwargs)
        assert response.status_code == status_code, (
            f"Expected status code {status_code} for {method.upper()} {url}, "
            f"got {response.status_code}."
        )
        return response
