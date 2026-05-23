import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from starlette.datastructures import Headers, MutableHeaders
from starlette.middleware.cors import CORSMiddleware as CORSMiddleware  # noqa
from starlette.responses import PlainTextResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class DynamicCORSMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        allow_origin_func: Callable[[str], bool | Awaitable[bool]] | None = None,
        allow_origins: list[str] | None = None,
        allow_methods: list[str] | None = None,
        allow_headers: list[str] | None = None,
        allow_credentials: bool = False,
        allow_origin_regex: str | None = None,
        expose_headers: list[str] | None = None,
        max_age: int = 600,
        cors_max_age: int | None = None,
    ) -> None:
        self.app = app
        self.allow_origin_func = allow_origin_func
        self.allow_origins = allow_origins or []
        self.allow_methods = allow_methods or ["GET"]
        self.allow_headers = allow_headers or []
        self.allow_credentials = allow_credentials
        self.allow_origin_regex = allow_origin_regex
        self.expose_headers = expose_headers or []
        self.max_age = cors_max_age if cors_max_age is not None else max_age
        self._is_async = asyncio.iscoroutinefunction(allow_origin_func) if allow_origin_func else False

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "GET")
        headers = Headers(scope=scope)
        origin = headers.get("origin")

        if origin is None:
            await self.app(scope, receive, send)
            return

        if method == "OPTIONS" and headers.get("access-control-request-method"):
            await self._preflight(scope, receive, send, origin)
            return

        await self._add_cors_headers(scope, origin)
        await self.app(scope, receive, send)

    async def _is_allowed(self, origin: str) -> bool:
        if self.allow_origin_func:
            result = self.allow_origin_func(origin)
            if self._is_async:
                result = await result
            return bool(result)
        if self.allow_origin_regex:
            import re
            if re.match(self.allow_origin_regex, origin):
                return True
        return origin in self.allow_origins or "*" in self.allow_origins

    async def _preflight(self, scope: Scope, receive: Receive, send: Send, origin: str) -> None:
        allowed = await self._is_allowed(origin)
        scope_headers: dict[str, str] = {}
        if allowed:
            scope_headers["access-control-allow-origin"] = origin
            scope_headers["access-control-allow-methods"] = ", ".join(self.allow_methods)
            scope_headers["access-control-allow-headers"] = ", ".join(self.allow_headers)
            scope_headers["access-control-max-age"] = str(self.max_age)
        response = PlainTextResponse("OK", status_code=200, headers=scope_headers)
        await response(scope, receive, send)

    async def _add_cors_headers(self, scope: Scope, origin: str) -> None:
        allowed = await self._is_allowed(origin)
        original_send: Send = scope["send"]

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                if allowed:
                    headers["Access-Control-Allow-Origin"] = origin
                    if self.allow_credentials:
                        headers["Access-Control-Allow-Credentials"] = "true"
                if self.expose_headers:
                    headers["Access-Control-Expose-Headers"] = ", ".join(self.expose_headers)
            await original_send(message)

        scope["send"] = send_wrapper
