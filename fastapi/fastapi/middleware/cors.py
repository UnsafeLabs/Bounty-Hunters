import inspect
from collections.abc import Awaitable, Callable, Iterable
from typing import Any

from starlette.datastructures import Headers, MutableHeaders
from starlette.middleware.cors import CORSMiddleware as CORSMiddleware  # noqa
from starlette.responses import PlainTextResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

AllowOriginFunc = Callable[[str], bool | Awaitable[bool]]


class DynamicCORSMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        *,
        allow_origin_func: AllowOriginFunc | None = None,
        allow_origins: Iterable[str] = (),
        allow_methods: Iterable[str] = ("GET",),
        allow_headers: Iterable[str] = (),
        allow_credentials: bool = False,
        cors_max_age: int = 600,
    ) -> None:
        self.app = app
        self.allow_origin_func = allow_origin_func
        self.allow_origins = set(allow_origins)
        self.allow_all_origins = "*" in self.allow_origins
        self.allow_methods = ", ".join(allow_methods)
        self.allow_headers = ", ".join(allow_headers)
        self.allow_credentials = allow_credentials
        self.cors_max_age = str(cors_max_age)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        origin = headers.get("origin")
        if origin is None:
            await self.app(scope, receive, send)
            return

        if (
            scope["method"] == "OPTIONS"
            and headers.get("access-control-request-method") is not None
        ):
            response = await self.preflight_response(origin)
            await response(scope, receive, send)
            return

        async def send_with_cors(message: Message) -> None:
            if message["type"] == "http.response.start" and await self.is_allowed_origin(origin):
                response_headers = MutableHeaders(scope=message)
                self.add_cors_headers(response_headers, origin)
            await send(message)

        await self.app(scope, receive, send_with_cors)

    async def preflight_response(self, origin: str) -> PlainTextResponse:
        allowed = await self.is_allowed_origin(origin)
        status_code = 200 if allowed else 400
        headers: dict[str, str] = {
            "Access-Control-Allow-Methods": self.allow_methods,
            "Access-Control-Max-Age": self.cors_max_age,
        }
        if self.allow_headers:
            headers["Access-Control-Allow-Headers"] = self.allow_headers
        if allowed:
            headers["Access-Control-Allow-Origin"] = (
                "*" if self.allow_all_origins else origin
            )
            if self.allow_credentials:
                headers["Access-Control-Allow-Credentials"] = "true"
        return PlainTextResponse(
            "OK" if allowed else "Disallowed CORS origin",
            status_code=status_code,
            headers=headers,
        )

    async def is_allowed_origin(self, origin: str) -> bool:
        if self.allow_origin_func is not None:
            result = self.allow_origin_func(origin)
            if inspect.isawaitable(result):
                result = await result
            return bool(result)
        return self.allow_all_origins or origin in self.allow_origins

    def add_cors_headers(self, headers: MutableHeaders, origin: str) -> None:
        headers["Access-Control-Allow-Origin"] = "*" if self.allow_all_origins else origin
        if self.allow_credentials:
            headers["Access-Control-Allow-Credentials"] = "true"
