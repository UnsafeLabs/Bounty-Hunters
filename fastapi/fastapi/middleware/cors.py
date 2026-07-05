import functools
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
        allow_private_network: bool = False,
        expose_headers: Sequence[str] = (),
        max_age: int = 600,
        allow_origin_func: AllowOriginFunc | None = None,
        cors_max_age: int | None = None,
    ) -> None:
        super().__init__(
            app,
            allow_origins=allow_origins,
            allow_methods=allow_methods,
            allow_headers=allow_headers,
            allow_credentials=allow_credentials,
            allow_origin_regex=allow_origin_regex,
            allow_private_network=allow_private_network,
            expose_headers=expose_headers,
            max_age=max_age if cors_max_age is None else cors_max_age,
        )
        self.allow_origin_func = allow_origin_func

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if self.allow_origin_func is None:
            await super().__call__(scope, receive, send)
            return

        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        method = scope["method"]
        headers = Headers(scope=scope)
        origin = headers.get("origin")

        if origin is None:
            await self.app(scope, receive, send)
            return

        origin_allowed = await self._is_dynamic_origin_allowed(origin)

        if method == "OPTIONS" and "access-control-request-method" in headers:
            response = self._dynamic_preflight_response(headers, origin_allowed)
            await response(scope, receive, send)
            return

        await self._dynamic_simple_response(
            scope, receive, send, headers, origin_allowed
        )

    async def _is_dynamic_origin_allowed(self, origin: str) -> bool:
        assert self.allow_origin_func is not None
        result = self.allow_origin_func(origin)
        if inspect.isawaitable(result):
            result = await result
        return bool(result)

    def _dynamic_preflight_response(
        self, request_headers: Headers, origin_allowed: bool
    ) -> PlainTextResponse:
        requested_origin = request_headers["origin"]
        requested_method = request_headers["access-control-request-method"]
        requested_headers = request_headers.get("access-control-request-headers")
        requested_private_network = request_headers.get(
            "access-control-request-private-network"
        )

        headers = dict(self.preflight_headers)
        headers.pop("Access-Control-Allow-Origin", None)
        failures: list[str] = []

        if origin_allowed:
            headers["Access-Control-Allow-Origin"] = requested_origin
            headers["Vary"] = "Origin"
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

        if requested_private_network is not None:
            if self.allow_private_network:
                headers["Access-Control-Allow-Private-Network"] = "true"
            else:
                failures.append("private-network")

        if failures:
            failure_text = "Disallowed CORS " + ", ".join(failures)
            return PlainTextResponse(failure_text, status_code=400, headers=headers)

        return PlainTextResponse("OK", status_code=200, headers=headers)

    async def _dynamic_simple_response(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
        request_headers: Headers,
        origin_allowed: bool,
    ) -> None:
        send = functools.partial(
            self._dynamic_send,
            send=send,
            request_headers=request_headers,
            origin_allowed=origin_allowed,
        )
        await self.app(scope, receive, send)

    async def _dynamic_send(
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
        headers.update(self.simple_headers)

        if origin_allowed:
            self.allow_explicit_origin(headers, request_headers["Origin"])
        elif "Access-Control-Allow-Origin" in headers:
            del headers["Access-Control-Allow-Origin"]

        await send(message)
