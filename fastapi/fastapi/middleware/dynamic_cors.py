"""Dynamic CORS origin validation with sync/async callbacks (issue #763)."""

from __future__ import annotations

import asyncio
import inspect
from typing import Awaitable, Callable, Iterable, Optional, Sequence, Union

from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import PlainTextResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

OriginFunc = Callable[[str], Union[bool, Awaitable[bool]]]


async def _call_origin_func(func: OriginFunc, origin: str) -> bool:
    result = func(origin)
    if inspect.isawaitable(result):
        return bool(await result)
    return bool(result)


class DynamicCORSMiddleware:
    """
    CORS middleware with optional per-request origin callback.

    If ``allow_origin_func`` is provided, it decides allow/deny dynamically.
    Otherwise falls back to the static ``allow_origins`` list (supports ``*``).
    """

    def __init__(
        self,
        app: ASGIApp,
        allow_origins: Sequence[str] = (),
        allow_origin_func: Optional[OriginFunc] = None,
        allow_methods: Sequence[str] = ("GET",),
        allow_headers: Sequence[str] = (),
        allow_credentials: bool = False,
        cors_max_age: int = 600,
        expose_headers: Sequence[str] = (),
    ) -> None:
        self.app = app
        self.allow_origins = list(allow_origins)
        self.allow_origin_func = allow_origin_func
        self.allow_methods = ", ".join(allow_methods)
        self.allow_headers = ", ".join(allow_headers)
        self.allow_credentials = allow_credentials
        self.cors_max_age = int(cors_max_age)
        self.expose_headers = ", ".join(expose_headers)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        origin = headers.get("origin")

        if origin is None:
            await self.app(scope, receive, send)
            return

        allowed = await self.is_allowed_origin(origin)
        method = scope.get("method", "GET").upper()

        if method == "OPTIONS" and "access-control-request-method" in headers:
            response = await self.preflight(origin, allowed)
            await response(scope, receive, send)
            return

        await self.simple(scope, receive, send, origin, allowed)

    async def is_allowed_origin(self, origin: str) -> bool:
        if self.allow_origin_func is not None:
            return await _call_origin_func(self.allow_origin_func, origin)
        if "*" in self.allow_origins:
            return True
        return origin in self.allow_origins

    async def preflight(self, origin: str, allowed: bool) -> Response:
        if not allowed:
            return PlainTextResponse("Disallowed CORS origin", status_code=400)
        headers = {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": self.allow_methods,
            "Access-Control-Max-Age": str(self.cors_max_age),
        }
        if self.allow_headers:
            headers["Access-Control-Allow-Headers"] = self.allow_headers
        if self.allow_credentials:
            headers["Access-Control-Allow-Credentials"] = "true"
        headers["Vary"] = "Origin"
        return PlainTextResponse("OK", status_code=200, headers=headers)

    async def simple(
        self, scope: Scope, receive: Receive, send: Send, origin: str, allowed: bool
    ) -> None:
        if not allowed:
            await self.app(scope, receive, send)
            return

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["Access-Control-Allow-Origin"] = origin
                headers.add_vary_header("Origin")
                if self.allow_credentials:
                    headers["Access-Control-Allow-Credentials"] = "true"
                if self.expose_headers:
                    headers["Access-Control-Expose-Headers"] = self.expose_headers
            await send(message)

        await self.app(scope, receive, send_wrapper)


# Keep re-export of Starlette CORSMiddleware from cors.py unchanged; add dynamic there.
