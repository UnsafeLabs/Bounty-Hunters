import functools
from collections.abc import Awaitable, Callable, Sequence
from inspect import isawaitable

from starlette.datastructures import Headers, MutableHeaders
from starlette.middleware.cors import CORSMiddleware as CORSMiddleware
from starlette.responses import PlainTextResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

OriginCheck = Callable[[str], bool | Awaitable[bool]]


class DynamicCORSMiddleware(CORSMiddleware):
    def __init__(
        self,
        app: ASGIApp,
        allow_origin_func: OriginCheck | None = None,
        allow_origins: Sequence[str] = (),
        allow_methods: Sequence[str] = ("GET",),
        allow_headers: Sequence[str] = (),
        allow_credentials: bool = False,
        allow_origin_regex: str | None = None,
        expose_headers: Sequence[str] = (),
        cors_max_age: int = 600,
    ) -> None:
        self.allow_origin_func = allow_origin_func
        super().__init__(
            app=app,
            allow_origins=allow_origins,
            allow_methods=allow_methods,
            allow_headers=allow_headers,
            allow_credentials=allow_credentials,
            allow_origin_regex=allow_origin_regex,
            expose_headers=expose_headers,
            max_age=cors_max_age,
        )

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

        origin_allowed = await self._is_origin_allowed(origin)

        if method == "OPTIONS" and "access-control-request-method" in headers:
            response = self.preflight_response_for_origin(
                request_headers=headers, origin_allowed=origin_allowed
            )
            await response(scope, receive, send)
            return

        await self.simple_response_for_origin(
            scope,
            receive,
            send,
            request_headers=headers,
            origin_allowed=origin_allowed,
        )

    async def _is_origin_allowed(self, origin: str) -> bool:
        result = self.allow_origin_func(origin)
        if isawaitable(result):
            result = await result
        return bool(result)

    def preflight_response_for_origin(
        self, request_headers: Headers, origin_allowed: bool
    ) -> Response:
        requested_origin = request_headers["origin"]
        requested_method = request_headers["access-control-request-method"]
        requested_headers = request_headers.get("access-control-request-headers")

        headers = dict(self.preflight_headers)
        headers.pop("Access-Control-Allow-Origin", None)
        self._add_vary_origin(headers)
        failures = []

        if origin_allowed:
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
        origin_allowed: bool,
    ) -> None:
        send = functools.partial(
            self.send_for_origin,
            send=send,
            request_headers=request_headers,
            origin_allowed=origin_allowed,
        )
        await self.app(scope, receive, send)

    async def send_for_origin(
        self,
        message: Message,
        send: Send,
        request_headers: Headers,
        origin_allowed: bool,
    ) -> None:
        if message["type"] != "http.response.start":
            await send(message)
            return

        message.setdefault("headers", [])
        headers = MutableHeaders(scope=message)
        simple_headers = dict(self.simple_headers)
        simple_headers.pop("Access-Control-Allow-Origin", None)
        headers.update(simple_headers)

        if origin_allowed:
            origin = request_headers["Origin"]
            self.allow_explicit_origin(headers, origin)

        await send(message)

    @staticmethod
    def _add_vary_origin(headers: dict[str, str]) -> None:
        vary = headers.get("Vary")
        if vary is None:
            headers["Vary"] = "Origin"
            return
        if "origin" not in [value.strip().lower() for value in vary.split(",")]:
            headers["Vary"] = f"{vary}, Origin"
