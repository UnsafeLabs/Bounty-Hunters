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
        subprotocols: list[str] | None = None,
        **kwargs: Any,
    ):
        merged_headers = dict(headers or {})
        if "Authorization" in self.headers and "Authorization" not in merged_headers:
            merged_headers["Authorization"] = self.headers["Authorization"]
        return self.websocket_connect(
            url,
            headers=merged_headers,
            subprotocols=subprotocols,
            **kwargs,
        )

    def assert_status(self, method: str, url: str, expected_status: int, **kwargs: Any):
        response = self.request(method, url, **kwargs)
        if response.status_code != expected_status:
            raise AssertionError(
                f"Expected status {expected_status} for {method.upper()} {url}, "
                f"got {response.status_code}: {response.text}"
            )
        return response
