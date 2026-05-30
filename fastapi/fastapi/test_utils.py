from __future__ import annotations

import base64
import contextlib
import json
from typing import Any, Generator

from fastapi import FastAPI
from fastapi.testclient import TestClient


class WebSocketTestSession:
    def __init__(self, websocket: Any) -> None:
        self._ws = websocket

    def send_text(self, data: str) -> None:
        self._ws.send_text(data)

    def receive_text(self) -> str:
        return self._ws.receive_text()

    def send_json(self, data: Any) -> None:
        self._ws.send_text(json.dumps(data))

    def receive_json(self) -> Any:
        return json.loads(self._ws.receive_text())

    def close(self, code: int = 1000) -> None:
        self._ws.close(code)

    def wait_for(self, expected: dict[str, Any], timeout: float = 5.0) -> dict[str, Any]:
        import time

        deadline = time.monotonic() + timeout
        while True:
            msg = self.receive_json()
            if isinstance(msg, dict) and all(msg.get(k) == v for k, v in expected.items()):
                return msg
            if time.monotonic() >= deadline:
                raise TimeoutError(
                    f"Timed out waiting for {expected!r}, last message: {msg!r}"
                )

    def __enter__(self) -> WebSocketTestSession:
        return self

    def __exit__(self, *exc: Any) -> None:
        try:
            self.close()
        except Exception:
            pass


class FastAPITestClient(TestClient):
    def __init__(
        self,
        app: FastAPI,
        *,
        base_url: str = "http://testserver",
        raise_server_exceptions: bool = True,
        root_path: str = "",
        default_auth_token: str | None = None,
    ) -> None:
        super().__init__(
            app,
            base_url=base_url,
            raise_server_exceptions=raise_server_exceptions,
            root_path=root_path,
        )
        self.default_auth_token = default_auth_token
        self._auth_headers: dict[str, str] = {}

    def set_bearer_token(self, token: str) -> None:
        self._auth_headers["Authorization"] = f"Bearer {token}"
        self.default_auth_token = token

    def set_basic_auth(self, username: str, password: str) -> None:
        credentials = base64.b64encode(f"{username}:{password}".encode()).decode()
        self._auth_headers["Authorization"] = f"Basic {credentials}"

    def set_api_key(self, key: str, header_name: str = "X-API-Key") -> None:
        self._auth_headers[header_name] = key

    def set_auth_headers(self, headers: dict[str, str]) -> None:
        self._auth_headers.update(headers)

    def clear_auth(self) -> None:
        self._auth_headers.clear()
        self.default_auth_token = None

    def login(
        self,
        url: str,
        username: str,
        password: str,
        *,
        form_data: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        data: dict[str, str] = {
            "username": username,
            "password": password,
            "grant_type": "password",
        }
        if form_data:
            data.update(form_data)
        response = self.post(url, data=data)
        response.raise_for_status()
        token_data = response.json()
        access_token = token_data.get("access_token")
        if access_token:
            self.set_bearer_token(access_token)
        return token_data

    def create_test_user(
        self,
        url: str,
        *,
        username: str = "testuser",
        password: str = "testpassword",
        extra: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"username": username, "password": password}
        if extra:
            payload.update(extra)
        response = self.post(url, json=payload)
        response.raise_for_status()
        return response.json()

    def _merge_auth_headers(self, headers: dict[str, str] | None) -> dict[str, str] | None:
        if not self._auth_headers:
            return headers
        if headers is None:
            return dict(self._auth_headers)
        merged = dict(self._auth_headers)
        merged.update(headers)
        return merged

    def _merge_ws_headers(self, headers: dict[str, str] | None) -> dict[str, str]:
        if headers is None:
            if self._auth_headers:
                return dict(self._auth_headers)
            return {}
        if self._auth_headers:
            merged = dict(self._auth_headers)
            merged.update(headers)
            return merged
        return headers

    def get(self, url: str, **kwargs: Any) -> Any:
        kwargs.setdefault("headers", None)
        kwargs["headers"] = self._merge_auth_headers(kwargs["headers"])
        return super().get(url, **kwargs)

    def post(self, url: str, **kwargs: Any) -> Any:
        kwargs.setdefault("headers", None)
        kwargs["headers"] = self._merge_auth_headers(kwargs["headers"])
        return super().post(url, **kwargs)

    def put(self, url: str, **kwargs: Any) -> Any:
        kwargs.setdefault("headers", None)
        kwargs["headers"] = self._merge_auth_headers(kwargs["headers"])
        return super().put(url, **kwargs)

    def patch(self, url: str, **kwargs: Any) -> Any:
        kwargs.setdefault("headers", None)
        kwargs["headers"] = self._merge_auth_headers(kwargs["headers"])
        return super().patch(url, **kwargs)

    def delete(self, url: str, **kwargs: Any) -> Any:
        kwargs.setdefault("headers", None)
        kwargs["headers"] = self._merge_auth_headers(kwargs["headers"])
        return super().delete(url, **kwargs)

    def head(self, url: str, **kwargs: Any) -> Any:
        kwargs.setdefault("headers", None)
        kwargs["headers"] = self._merge_auth_headers(kwargs["headers"])
        return super().head(url, **kwargs)

    def options(self, url: str, **kwargs: Any) -> Any:
        kwargs.setdefault("headers", None)
        kwargs["headers"] = self._merge_auth_headers(kwargs["headers"])
        return super().options(url, **kwargs)

    @contextlib.contextmanager
    def ws_connect(
        self,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        **kwargs: Any,
    ) -> Generator[WebSocketTestSession, None, None]:
        merged_headers = self._merge_ws_headers(headers)
        with self.websocket_connect(url, headers=merged_headers, **kwargs) as ws:
            yield WebSocketTestSession(ws)

    def request_authenticated(self, method: str, url: str, **kwargs: Any) -> Any:
        return getattr(self, method.lower())(url, **kwargs)

    def assert_status(self, response: Any, expected: int) -> None:
        assert response.status_code == expected, (
            f"Expected status {expected}, got {response.status_code}: {response.text}"
        )

    def assert_json(self, response: Any, expected: dict[str, Any] | list[Any]) -> None:
        assert response.json() == expected, (
            f"Expected JSON {expected!r}, got {response.json()!r}"
        )
