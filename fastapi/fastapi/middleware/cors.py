import functools
import inspect
from typing import Any, Callable, Coroutine, Optional, Sequence, Union

from starlette.datastructures import Headers, MutableHeaders
from starlette.middleware.cors import CORSMiddleware as CORSMiddleware  # noqa
from starlette.responses import PlainTextResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class DynamicCORSMiddleware(CORSMiddleware):
    def __init__(
        self,
        app: ASGIApp,
        allow_origins: Sequence[str] = (),
        allow_methods: Sequence[str] = ("GET",),
        allow_headers: Sequence[str] = (),
        allow_credentials: bool = False,
        allow_origin_regex: Optional[str] = None,
        allow_private_network: bool = False,
        expose_headers: Sequence[str] = (),
        max_age: int = 600,
        allow_origin_func: Optional[Callable[[str], Union[bool, Coroutine[Any, Any, bool]]]] = None,
        cors_max_age: Optional[int] = None,
    ) -> None:
        super().__init__(
            app=app,
            allow_origins=allow_origins,
            allow_methods=allow_methods,
            allow_headers=allow_headers,
            allow_credentials=allow_credentials,
            allow_origin_regex=allow_origin_regex,
            allow_private_network=allow_private_network,
            expose_headers=expose_headers,
            max_age=cors_max_age if cors_max_age is not None else max_age,
        )
        self.allow_origin_func = allow_origin_func

    async def is_allowed_origin_dynamic(self, origin: str) -> bool:
        if self.allow_origin_func is not None:
            res = self.allow_origin_func(origin)
            if inspect.isawaitable(res):
                return await res
            return res
        return self.is_allowed_origin(origin)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        method = scope["method"]
        headers = Headers(scope=scope)
        origin = headers.get("origin")

        if origin is None:
            await self.app(scope, receive, send)
            return

        if method == "OPTIONS" and "access-control-request-method" in headers:
            response = await self.async_preflight_response(request_headers=headers)
            await response(scope, receive, send)
            return

        await self.simple_response(scope, receive, send, request_headers=headers)

    async def async_preflight_response(self, request_headers: Headers) -> Response:
        requested_origin = request_headers["origin"]
        requested_method = request_headers["access-control-request-method"]
        requested_headers = request_headers.get("access-control-request-headers")
        requested_private_network = request_headers.get(
            "access-control-request-private-network"
        )

        headers = dict(self.preflight_headers)
        failures: list[str] = []

        is_allowed = await self.is_allowed_origin_dynamic(origin=requested_origin)
        if is_allowed:
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

        if requested_private_network is not None:
            if self.allow_private_network:
                headers["Access-Control-Allow-Private-Network"] = "true"
            else:
                failures.append("private-network")

        if failures:
            failure_text = "Disallowed CORS " + ", ".join(failures)
            return PlainTextResponse(failure_text, status_code=400, headers=headers)

        return PlainTextResponse("OK", status_code=200, headers=headers)

    async def simple_response(
        self, scope: Scope, receive: Receive, send: Send, request_headers: Headers
    ) -> None:
        send = functools.partial(self.async_send, send=send, request_headers=request_headers)
        await self.app(scope, receive, send)

    async def async_send(
        self, message: Message, send: Send, request_headers: Headers
    ) -> None:
        if message["type"] != "http.response.start":
            await send(message)
            return

        message.setdefault("headers", [])
        headers = MutableHeaders(scope=message)
        headers.update(self.simple_headers)
        origin = request_headers["Origin"]

        if self.allow_all_origins and self.allow_credentials:
            self.allow_explicit_origin(headers, origin)
        elif not self.allow_all_origins and await self.is_allowed_origin_dynamic(
            origin=origin
        ):
            self.allow_explicit_origin(headers, origin)

        await send(message)
