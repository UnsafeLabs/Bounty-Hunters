import base64
from typing import Any, Dict, List, Mapping, Optional, Union

from starlette.testclient import TestClient as TestClient  # noqa: F401

# Re-export base TestClient for backward compatibility (do not change import path).
__all__ = ["TestClient", "FastAPITestClient"]


class FastAPITestClient(TestClient):
    """
    Starlette/FastAPI TestClient with auth + WebSocket helpers (bounty #804).

    Extends TestClient without changing the existing `TestClient` re-export.
    """

    def __init__(self, app: Any, *args: Any, **kwargs: Any) -> None:
        super().__init__(app, *args, **kwargs)
        self._auth_headers: Dict[str, str] = {}

    def _merge_headers(
        self, headers: Optional[Union[Mapping[str, str], Dict[str, str]]]
    ) -> Dict[str, str]:
        merged: Dict[str, str] = dict(self._auth_headers)
        if headers:
            merged.update(dict(headers))
        return merged

    def authenticate(self, token: str) -> None:
        """Attach `Authorization: Bearer <token>` to all subsequent requests."""
        self._auth_headers["Authorization"] = f"Bearer {token}"

    def authenticate_basic(self, username: str, password: str) -> None:
        """Attach HTTP Basic Authorization (base64 username:password)."""
        raw = f"{username}:{password}".encode("utf-8")
        encoded = base64.b64encode(raw).decode("ascii")
        self._auth_headers["Authorization"] = f"Basic {encoded}"

    def reset_auth(self) -> None:
        """Clear authentication headers set via authenticate / authenticate_basic."""
        self._auth_headers.clear()

    def request(self, method: str, url: str, **kwargs: Any):  # type: ignore[override]
        headers = self._merge_headers(kwargs.pop("headers", None))
        return super().request(method, url, headers=headers, **kwargs)

    def assert_status(
        self,
        method: str,
        url: str,
        expected_status: int,
        **kwargs: Any,
    ):
        """
        Perform a request and assert the response status code.
        Raises AssertionError with expected vs actual on mismatch.
        """
        response = self.request(method, url, **kwargs)
        if response.status_code != expected_status:
            body = getattr(response, "text", "")[:500]
            raise AssertionError(
                f"Expected status {expected_status}, got {response.status_code} "
                f"for {method.upper()} {url}. Body: {body!r}"
            )
        return response

    def ws_connect(
        self,
        url: str,
        headers: Optional[Mapping[str, str]] = None,
        subprotocols: Optional[List[str]] = None,
        **kwargs: Any,
    ):
        """
        Open a WebSocket with optional custom headers and subprotocols.
        Returns the same context manager as TestClient.websocket_connect.
        """
        merged = self._merge_headers(headers)
        return self.websocket_connect(
            url,
            headers=merged,
            subprotocols=subprotocols,
            **kwargs,
        )
