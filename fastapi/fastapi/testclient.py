from collections.abc import AsyncIterator
from typing import Any

from starlette.testclient import TestClient as _TestClient


class FastAPITestClient(_TestClient):
    def __init__(self, app, **kwargs):
        super().__init__(app, **kwargs)
        self._auth_token: str | None = None
        self._auth_header: str = "Authorization"
        self._headers_override: dict[str, str] = {}

    def authenticate(self, token: str, scheme: str = "Bearer") -> None:
        self._auth_token = f"{scheme} {token}"
        self._headers_override[self._auth_header] = self._auth_token

    def authenticate_basic(self, username: str, password: str) -> None:
        import base64
        encoded = base64.b64encode(f"{username}:{password}".encode()).decode()
        self._headers_override[self._auth_header] = f"Basic {encoded}"

    def clear_auth(self) -> None:
        self._auth_token = None
        self._headers_override.pop(self._auth_header, None)

    def request(self, method: str, url: str, **kwargs) -> Any:
        headers = kwargs.pop("headers", {})
        headers.update(self._headers_override)
        return super().request(method, url, headers=headers, **kwargs)

    def websocket_connect(self, url: str, **kwargs) -> Any:
        headers = kwargs.pop("headers", {})
        headers.update(self._headers_override)
        return super().websocket_connect(url, headers=headers, **kwargs)


TestClient = FastAPITestClient
