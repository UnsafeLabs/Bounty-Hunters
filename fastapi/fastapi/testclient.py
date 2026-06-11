import base64
from typing import Any

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
        credentials = f"{username}:{password}".encode("utf-8")
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
        headers: dict[str, str] | None = None,
        subprotocols: list[str] | None = None,
        **kwargs: Any,
    ) -> Any:
        merged_headers = dict(self.headers)
        if headers:
            merged_headers.update(headers)
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
    ) -> Any:
        response = self.request(method, url, **kwargs)
        if response.status_code != expected_status:
            raise AssertionError(
                f"Expected {expected_status} for {method.upper()} {url}, "
                f"got {response.status_code}: {response.text}"
            )
        return response
