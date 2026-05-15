import asyncio
import typing

from starlette.datastructures import Headers, MutableHeaders
from starlette.middleware.cors import CORSMiddleware as StarletteCORSMiddleware
from starlette.responses import PlainTextResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class CORSMiddleware(StarletteCORSMiddleware):
    pass


class DynamicCORSMiddleware(StarletteCORSMiddleware):
    def __init__(
        self,
        app: ASGIApp,
        allow_origins: typing.Sequence[str] = (),
        allow_methods: typing.Sequence[str] = ("GET",),
        allow_headers: typing.Sequence[str] = (),
        allow_credentials: bool = False,
        allow_origin_regex: str | None = None,
        expose_headers: typing.Sequence[str] = (),
        max_age: int = 600,
        cors_max_age: int | None = None,
        allow_origin_func: typing.Callable[[str], typing.Union[bool, typing.Awaitable[bool]]] | None = None,
    ) -> None:
        if cors_max_age is not None:
            max_age = cors_max_age
        
        super().__init__(
            app=app,
            allow_origins=allow_origins,
            allow_methods=allow_methods,
            allow_headers=allow_headers,
            allow_credentials=allow_credentials,
            allow_origin_regex=allow_origin_regex,
            expose_headers=expose_headers,
            max_age=max_age,
        )
        self.allow_origin_func = allow_origin_func

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":  # pragma: no cover
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        origin = headers.get("origin")

        if origin is None:
            await self.app(scope, receive, send)
            return

        # Perform dynamic check
        is_allowed = await self._check_origin(origin)

        method = scope["method"]
        if method == "OPTIONS" and "access-control-request-method" in headers:
            response = self.preflight_response_with_result(request_headers=headers, is_allowed=is_allowed)
            await response(scope, receive, send)
            return

        await self.simple_response_with_result(scope, receive, send, request_headers=headers, is_allowed=is_allowed)

    async def _check_origin(self, origin: str) -> bool:
        if self.allow_origin_func:
            if asyncio.iscoroutinefunction(self.allow_origin_func):
                return await self.allow_origin_func(origin)
            return self.allow_origin_func(origin)
        return self.is_allowed_origin(origin)

    def preflight_response_with_result(self, request_headers: Headers, is_allowed: bool) -> Response:
        requested_method = request_headers["access-control-request-method"]
        requested_headers = request_headers.get("access-control-request-headers")

        headers = dict(self.preflight_headers)
        failures = []

        if is_allowed:
            if self.preflight_explicit_allow_origin:
                headers["Access-Control-Allow-Origin"] = request_headers["origin"]
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

    async def simple_response_with_result(
        self, scope: Scope, receive: Receive, send: Send, request_headers: Headers, is_allowed: bool
    ) -> None:
        import functools
        send = functools.partial(self.send_with_result, send=send, request_headers=request_headers, is_allowed=is_allowed)
        await self.app(scope, receive, send)

    async def send_with_result(
        self, message: Message, send: Send, request_headers: Headers, is_allowed: bool
    ) -> None:
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
        elif not self.allow_all_origins and is_allowed:
            self.allow_explicit_origin(headers, origin)

        await send(message)
