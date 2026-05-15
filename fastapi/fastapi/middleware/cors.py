import inspect
from collections.abc import Awaitable, Callable, Sequence

from starlette.datastructures import Headers, MutableHeaders
from starlette.middleware.cors import CORSMiddleware as CORSMiddleware  # noqa
from starlette.responses import PlainTextResponse, Response
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
        allow_origin_func: AllowOriginFunc | None = None,
        cors_max_age: int = 600,
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
            max_age=cors_max_age,
        )
        self.allow_origin_func = allow_origin_func
        if allow_origin_func is not None:
            self.simple_headers.pop("Access-Control-Allow-Origin", None)
            self.preflight_headers.pop("Access-Control-Allow-Origin", None)
            self.preflight_headers["Vary"] = "Origin"
            self.preflight_explicit_allow_origin = True

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
            response = await self.preflight_response_async(request_headers=headers)
            await response(scope, receive, send)
            return

        await self.simple_response(scope, receive, send, request_headers=headers)

    async def is_allowed_origin_async(self, origin: str) -> bool:
        if self.allow_origin_func is None:
            return self.is_allowed_origin(origin=origin)

        try:
            allowed = self.allow_origin_func(origin)
            if inspect.isawaitable(allowed):
                allowed = await allowed
        except Exception:
            # If the callback fails, treat as deny (secure-by-default).
            return False
        return bool(allowed)

    async def preflight_response_async(self, request_headers: Headers) -> Response:
        requested_origin = request_headers["origin"]
        requested_method = request_headers["access-control-request-method"]
        requested_headers = request_headers.get("access-control-request-headers")
        requested_private_network = request_headers.get(
            "access-control-request-private-network"
        )

        headers = dict(self.preflight_headers)
        failures: list[str] = []

        if await self.is_allowed_origin_async(origin=requested_origin):
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

    async def send(
        self, message: Message, send: Send, request_headers: Headers
    ) -> None:
        if message["type"] != "http.response.start":
            await send(message)
            return

        message.setdefault("headers", [])
        headers = MutableHeaders(scope=message)
        headers.update(self.simple_headers)
        origin = request_headers["Origin"]
        has_cookie = "cookie" in request_headers

        if self.allow_origin_func is not None:
            # Ensure caches don't serve a response computed for one Origin to another.
            headers.add_vary_header("Origin")
            if await self.is_allowed_origin_async(origin=origin):
                self.allow_explicit_origin(headers, origin)
        elif self.allow_all_origins and has_cookie:
            self.allow_explicit_origin(headers, origin)
        elif not self.allow_all_origins and await self.is_allowed_origin_async(
            origin=origin
        ):
            self.allow_explicit_origin(headers, origin)

        await send(message)
