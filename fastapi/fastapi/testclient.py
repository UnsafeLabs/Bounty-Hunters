import base64
from collections.abc import Sequence
from typing import Any

from starlette.testclient import TestClient as TestClient  # noqa
from starlette.testclient import WebSocketTestSession


class FastAPITestClient(TestClient):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._auth_header: dict[str, str] = {}

    def authenticate(self, token: str) -> None:
        self._auth_header = {"Authorization": f"Bearer {token}"}

    def authenticate_basic(self, username: str, password: str) -> None:
        raw = base64.b64encode(f"{username}:{password}".encode()).decode("ascii")
        self._auth_header = {"Authorization": f"Basic {raw}"}

    def reset_auth(self) -> None:
        self._auth_header = {}

    def request(  # type: ignore[override]
        self,
        method: str,
        url: str,
        **kwargs: Any,
    ) -> Any:
        headers = kwargs.pop("headers", None) or {}
        headers = {**self._auth_header, **headers}
        return super().request(method, url, headers=headers, **kwargs)

    def ws_connect(
        self,
        url: str,
        subprotocols: Sequence[str] | None = None,
        **kwargs: Any,
    ) -> WebSocketTestSession:
        headers = {**self._auth_header, **kwargs.pop("headers", {})}
        return super().websocket_connect(url, subprotocols=subprotocols, headers=headers, **kwargs)

    def assert_status(
        self,
        method: str,
        url: str,
        expected_status: int,
        **kwargs: Any,
    ) -> Any:
        response = self.request(method, url, **kwargs)
        assert response.status_code == expected_status, (
            f"Expected status {expected_status}, got {response.status_code}: {response.text[:200]}"
        )
        return response
