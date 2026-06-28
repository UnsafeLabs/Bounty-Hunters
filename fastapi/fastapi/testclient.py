from base64 import b64encode
from collections.abc import Mapping, Sequence
from typing import Any

from httpx import Response
from starlette.testclient import TestClient as TestClient  # noqa


class FastAPITestClient(TestClient):
    def authenticate(self, token: str) -> None:
        self.headers["Authorization"] = f"Bearer {token}"

    def authenticate_basic(self, username: str, password: str) -> None:
        credentials = f"{username}:{password}".encode()
        self.headers["Authorization"] = (
            f"Basic {b64encode(credentials).decode('ascii')}"
        )

    def reset_auth(self) -> None:
        self.headers.pop("Authorization", None)

    def ws_connect(
        self,
        url: str,
        *,
        headers: Mapping[str, str] | None = None,
        subprotocols: Sequence[str] | None = None,
        **kwargs: Any,
    ) -> Any:
        merged_headers = dict(headers or {})
        has_authorization = any(
            key.lower() == "authorization" for key in merged_headers
        )
        authorization = self.headers.get("authorization")
        if authorization and not has_authorization:
            merged_headers["authorization"] = authorization
        return self.websocket_connect(
            url,
            subprotocols=subprotocols,
            headers=merged_headers,
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
        assert response.status_code == expected_status, (
            f"Expected status {expected_status} for {method.upper()} {url}, "
            f"got {response.status_code}. Response body: {response.text}"
        )
        return response
