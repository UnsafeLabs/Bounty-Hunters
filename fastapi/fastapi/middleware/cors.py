import functools
import inspect
from collections.abc import Awaitable, Callable, Sequence
from typing import Any

from starlette.datastructures import Headers, MutableHeaders
from starlette.middleware.cors import CORSMiddleware as CORSMiddleware
from starlette.responses import PlainTextResponse, Response
from starlette.types import Message, Receive, Scope, Send


class DynamicCORSMiddleware(CORSMiddleware):
    def __init__(
        self,
        app: Any,
        allow_origin_func: Callable[[str], bool | Awaitable[bool]] | None = None,
        cors_max_age: int = 600,
        allow_origins: Sequence[str] = (),
        **kwargs: Any,
    ) -> None:
        kwargs.setdefault("max_age", cors_max_age)
        super().__init__(app, allow_origins=allow_origins, **kwargs)
        self.allow_origin_func = allow_origin_func

    async def _is_allowed_origin(self, origin: str) -> bool:
        if self.allow_origin_func is None:
            return super().is_allowed_origin(origin)
        result = self.allow_origin_func(origin)
        if inspect.isawaitable(result):
            return bool(await result)
        return bool(result)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":  # pragma: no cover
            await self.app(scope, receive, send)
            return

        method = scope["method"]
        headers = Headers(scope=scope)
        origin = headers.get("origin")

        if origin is None:
            await self.app(scope, receive, send)
            return

        if method == "OPTIONS" and "access-control-request-method" in headers:
            response = await self._preflight_response(request_headers=headers)
            await response(scope, receive, send)
            return

        allowed_origin = await self._is_allowed_origin(origin)
        await self._simple_response(scope, receive, send, request_headers=headers, allowed_origin=allowed_origin)

    async def _preflight_response(self, request_headers: Headers) -> Response:
        requested_origin = request_headers["origin"]
        requested_method = request_headers["access-control-request-method"]
        requested_headers = request_headers.get("access-control-request-headers")
        requested_private_network = request_headers.get("access-control-request-private-network")

        headers = dict(self.preflight_headers)
        failures: list[str] = []

        if await self._is_allowed_origin(requested_origin):
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
            return PlainTextResponse("Disallowed CORS " + ", ".join(failures), status_code=400, headers=headers)

        return PlainTextResponse("OK", status_code=200, headers=headers)

    async def _simple_response(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
        request_headers: Headers,
        allowed_origin: bool,
    ) -> None:
        send_with_cors = functools.partial(
            self._send_with_dynamic_origin,
            send=send,
            request_headers=request_headers,
            allowed_origin=allowed_origin,
        )
        await self.app(scope, receive, send_with_cors)

    async def _send_with_dynamic_origin(
        self,
        message: Message,
        send: Send,
        request_headers: Headers,
        allowed_origin: bool,
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
        elif not self.allow_all_origins and allowed_origin:
            self.allow_explicit_origin(headers, origin)

        await send(message)
