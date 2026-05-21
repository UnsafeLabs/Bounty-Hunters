from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable, Sequence

from starlette.datastructures import Headers, MutableHeaders
from starlette.middleware.cors import CORSMiddleware as CORSMiddleware  # noqa
from starlette.responses import PlainTextResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

AllowOriginFunc = Callable[[str], bool | Awaitable[bool]]


class DynamicCORSMiddleware(CORSMiddleware):
    def __init__(
        self,
        app: ASGIApp,
        allow_origins: Sequence[str] = (),
        allow_methods: Sequence[str] = ("GET",),
        allow_headers: Sequence[str] = (),
        allow_credentials: bool = False,
        allow_origin_regex: str | None = None,
        expose_headers: Sequence[str] = (),
        max_age: int = 600,
        allow_origin_func: AllowOriginFunc | None = None,
        cors_max_age: int | None = None,
    ) -> None:
        super().__init__(
            app=app,
            allow_origins=allow_origins,
            allow_methods=allow_methods,
            allow_headers=allow_headers,
            allow_credentials=allow_credentials,
            allow_origin_regex=allow_origin_regex,
            expose_headers=expose_headers,
            max_age=cors_max_age if cors_max_age is not None else max_age,
        )
        self.allow_origin_func = allow_origin_func

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if self.allow_origin_func is None:
            await super().__call__(scope, receive, send)
            return

        if scope["type"] != "http":  # pragma: no cover
            await self.app(scope, receive, send)
            return

        method = scope["method"]
        headers = Headers(scope=scope)
        origin = headers.get("origin")

        if origin is None:
            await self.app(scope, receive, send)
            return

        is_allowed = await self.is_allowed_origin_dynamic(origin)

        if method == "OPTIONS" and "access-control-request-method" in headers:
            response = self.preflight_response_for_origin(
                request_headers=headers,
                is_allowed_origin=is_allowed,
            )
            await response(scope, receive, send)
            return

        await self.simple_response_for_origin(
            scope,
            receive,
            send,
            request_headers=headers,
            is_allowed_origin=is_allowed,
        )

    async def is_allowed_origin_dynamic(self, origin: str) -> bool:
        if self.allow_origin_func is None:
            return self.is_allowed_origin(origin)

        result = self.allow_origin_func(origin)
        if inspect.isawaitable(result):
            result = await result
        return bool(result)

    def preflight_response_for_origin(
        self,
        request_headers: Headers,
        is_allowed_origin: bool,
    ) -> PlainTextResponse:
        requested_origin = request_headers["origin"]
        requested_method = request_headers["access-control-request-method"]
        requested_headers = request_headers.get("access-control-request-headers")

        headers = dict(self.preflight_headers)
        failures = []

        if is_allowed_origin:
            if self.preflight_explicit_allow_origin:
                headers["Access-Control-Allow-Origin"] = requested_origin
        else:
            failures.append("origin")

        if requested_method not in self.allow_methods:
            failures.append("method")

        if self.allow_all_headers and requested_headers is not None:
            headers["Access-Control-Allow-Headers"] = requested_headers
        elif requested_headers is not None:
            for header in [h.lower() for h in requested_headers.split(",")]:
                if header.strip() not in self.allow_headers:
                    failures.append("headers")
                    break

        if failures:
            failure_text = "Disallowed CORS " + ", ".join(failures)
            return PlainTextResponse(failure_text, status_code=400, headers=headers)

        return PlainTextResponse("OK", status_code=200, headers=headers)

    async def simple_response_for_origin(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
        request_headers: Headers,
        is_allowed_origin: bool,
    ) -> None:
        async def send_with_dynamic_origin(message: Message) -> None:
            if message["type"] != "http.response.start":
                await send(message)
                return

            message.setdefault("headers", [])
            headers = MutableHeaders(scope=message)
            headers.update(self.simple_headers)
            origin = request_headers["Origin"]
            has_cookie = "cookie" in request_headers

            if self.allow_all_origins and has_cookie:
                self.allow_explicit_origin(headers, origin)
            elif not self.allow_all_origins and is_allowed_origin:
                self.allow_explicit_origin(headers, origin)

            await send(message)

        await self.app(scope, receive, send_with_dynamic_origin)
