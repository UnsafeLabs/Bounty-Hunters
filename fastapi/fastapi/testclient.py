from collections.abc import Mapping
from typing import Any

from starlette.testclient import TestClient as StarletteTestClient


class TestClient(StarletteTestClient):
    def auth_headers(
        self,
        token: str,
        *,
        scheme: str = "Bearer",
        header_name: str = "Authorization",
        headers: Mapping[str, str] | None = None,
    ) -> dict[str, str]:
        merged_headers = dict(headers or {})
        merged_headers[header_name] = (
            token if scheme == "" else f"{scheme} {token}"
        )
        return merged_headers

    def websocket_connect_with_headers(
        self,
        url: str,
        *,
        token: str,
        scheme: str = "Bearer",
        header_name: str = "Authorization",
        headers: Mapping[str, str] | None = None,
        subprotocols: list[str] | None = None,
        **kwargs: Any,
    ):
        return super().websocket_connect(
            url,
            subprotocols=subprotocols,
            headers=self.auth_headers(
                token,
                scheme=scheme,
                header_name=header_name,
                headers=headers,
            ),
            **kwargs,
        )

