import base64
from typing import Any

from starlette.testclient import TestClient as TestClient  # noqa


class FastAPITestClient(TestClient):
    def authenticate(self, token: str) -> "FastAPITestClient":
        self.headers["Authorization"] = f"Bearer {token}"
        return self

    def authenticate_basic(self, username: str, password: str) -> "FastAPITestClient":
        credentials = base64.b64encode(f"{username}:{password}".encode()).decode(
            "ascii"
        )
        self.headers["Authorization"] = f"Basic {credentials}"
        return self

    def reset_auth(self) -> "FastAPITestClient":
        if "Authorization" in self.headers:
            del self.headers["Authorization"]
        return self

    def ws_connect(self, url: str, **kwargs: Any) -> Any:
        return self.websocket_connect(url, **kwargs)

    def assert_status(
        self, method: str, url: str, status_code: int, **kwargs: Any
    ) -> Any:
        response = self.request(method, url, **kwargs)
        if response.status_code != status_code:
            raise AssertionError(
                f"Expected {method.upper()} {url} to return {status_code}, "
                f"got {response.status_code}: {response.text}"
            )
        return response
