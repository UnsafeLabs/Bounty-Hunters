import functools
from collections.abc import Awaitable, Callable
from inspect import isawaitable
from typing import Any

from starlette.datastructures import Headers, MutableHeaders
from starlette.middleware.cors import CORSMiddleware as CORSMiddleware  # noqa
from starlette.responses import PlainTextResponse


class DynamicCORSMiddleware(CORSMiddleware):
    def __init__(
        self,
        app: Any,
        *,
        allow_origin_func: Callable[[str], bool | Awaitable[bool]] | None = None,
        cors_max_age: int | None = None,
        **kwargs: Any,
    ) -> None:
        self.allow_origin_func = allow_origin_func
        if cors_max_age is not None:
            kwargs["max_age"] = cors_max_age
        super().__init__(app, **kwargs)

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
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

        origin_allowed = await self._call_allow_origin_func(origin)
        if method == "OPTIONS" and "access-control-request-method" in headers:
            response = self._dynamic_preflight_response(
                request_headers=headers, origin_allowed=origin_allowed
            )
            await response(scope, receive, send)
            return

        await self._dynamic_simple_response(
            scope,
            receive,
            send,
            request_headers=headers,
            origin_allowed=origin_allowed,
        )

    async def _call_allow_origin_func(self, origin: str) -> bool:
        assert self.allow_origin_func is not None
        result = self.allow_origin_func(origin)
        if isawaitable(result):
            result = await result
        return bool(result)

    def _dynamic_preflight_response(
        self, *, request_headers: Headers, origin_allowed: bool
    ) -> PlainTextResponse:
        requested_origin = request_headers["origin"]
        requested_method = request_headers["access-control-request-method"]
        requested_headers = request_headers.get("access-control-request-headers")
        requested_private_network = request_headers.get(
            "access-control-request-private-network"
        )

        headers = dict(self.preflight_headers)
        headers.pop("Access-Control-Allow-Origin", None)
        headers["Vary"] = "Origin"
        failures: list[str] = []

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
        scope: Any,
        receive: Any,
        send: Any,
        *,
        request_headers: Headers,
        origin_allowed: bool,
    ) -> None:
        dynamic_send = functools.partial(
            self._dynamic_send,
            send=send,
            request_headers=request_headers,
            origin_allowed=origin_allowed,
        )
        await self.app(scope, receive, dynamic_send)

    async def _dynamic_send(
        self,
        message: Any,
        send: Any,
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
            self.allow_explicit_origin(headers, request_headers["Origin"])

        await send(message)
