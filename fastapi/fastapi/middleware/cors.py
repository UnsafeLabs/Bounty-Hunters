"""
CORS (Cross-Origin Resource Sharing) middleware.

This module re-exports Starlette's CORSMiddleware and provides a
DynamicCORSMiddleware that supports dynamic origin validation via a
callback function.
"""

from typing import Any, Callable, List, Optional, Union

from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp, Receive, Scope, Send

__all__ = ["CORSMiddleware", "DynamicCORSMiddleware"]


class DynamicCORSMiddleware:
    """
    A CORS middleware that supports dynamic origin validation.

    Unlike the standard CORSMiddleware which uses a static list of allowed
    origins, this middleware accepts an ``allow_origin_func`` callback that
    is invoked for each incoming request's Origin header. The callback
    receives the origin string and returns ``True`` to allow or ``False``
    to deny the request.

    Both synchronous and asynchronous callbacks are supported.

    If ``allow_origin_func`` is not provided, the middleware falls back to
    the static ``allow_origins`` list (defaulting to ``["*"]``).

    Args:
        app: The ASGI application to wrap.
        allow_origin_func: An optional sync or async callable that receives
            the origin string and returns a boolean indicating whether the
            origin is allowed.
        allow_origins: A static list of allowed origins. Used as a fallback
            when ``allow_origin_func`` is not provided.
        allow_methods: A list of HTTP methods to allow.
        allow_headers: A list of headers to allow.
        allow_credentials: Whether to allow credentials.
        expose_headers: A list of headers to expose.
        max_age: The value for the Access-Control-Max-Age header in
            preflight responses.
        cors_max_age: Alias for ``max_age``. If both are provided,
            ``cors_max_age`` takes precedence.
    """

    def __init__(
        self,
        app: ASGIApp,
        allow_origin_func: Optional[
            Union[
                Callable[[str], bool],
                Callable[[str], "Awaitable[bool]"],
            ]
        ] = None,
        allow_origins: Union[str, List[str]] = ["*"],
        allow_methods: List[str] = ["*"],
        allow_headers: List[str] = ["*"],
        allow_credentials: bool = False,
        expose_headers: List[str] = ["*"],
        max_age: Optional[int] = None,
        cors_max_age: Optional[int] = None,
    ) -> None:
        self.app = app
        self.allow_origin_func = allow_origin_func
        self.allow_origins = allow_origins
        self.allow_methods = allow_methods
        self.allow_headers = allow_headers
        self.allow_credentials = allow_credentials
        self.expose_headers = expose_headers
        # cors_max_age takes precedence over max_age
        self.max_age = cors_max_age if cors_max_age is not None else max_age

        # Build the set of allowed origins for static fallback
        if isinstance(allow_origins, str):
            self._allowed_origins_set = {allow_origins}
        else:
            self._allowed_origins_set = set(allow_origins)

        # Determine if we're using wildcard
        self._allow_all_origins = "*" in self._allowed_origins_set

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        request = Request(scope, receive)
        origin = request.headers.get("origin")

        if origin is None:
            # No origin header, just pass through
            await self.app(scope, receive, send)
            return

        # Determine if the origin is allowed
        if self.allow_origin_func is not None:
            allowed = await self._check_origin(origin)
        else:
            allowed = self._check_static_origin(origin)

        if not allowed:
            # Origin not allowed, return 403 for preflight, or just pass
            # through without CORS headers for simple requests
            if request.method == "OPTIONS":
                response = Response(
                    status_code=403,
                    content="Origin not allowed by CORS policy",
                )
                await response(scope, receive, send)
            else:
                await self.app(scope, receive, send)
            return

        # Origin is allowed, proceed with CORS headers
        if request.method == "OPTIONS":
            await self._handle_preflight(request, scope, receive, send)
        else:
            await self._handle_simple_request(request, origin, scope, receive, send)

    async def _check_origin(self, origin: str) -> bool:
        """
        Check if the origin is allowed using the dynamic callback.

        Supports both sync and async callbacks.
        """
        result = self.allow_origin_func(origin)
        if hasattr(result, "__await__"):
            result = await result
        return bool(result)

    def _check_static_origin(self, origin: str) -> bool:
        """
        Check if the origin is allowed using the static allow_origins list.
        """
        if self._allow_all_origins:
            return True
        return origin in self._allowed_origins_set

    async def _handle_preflight(
        self, request: Request, scope: Scope, receive: Receive, send: Send
    ) -> None:
        """Handle a CORS preflight (OPTIONS) request."""
        headers = {
            "Access-Control-Allow-Origin": self._get_allow_origin_header(request),
            "Access-Control-Allow-Methods": ", ".join(self.allow_methods),
            "Access-Control-Allow-Headers": ", ".join(self.allow_headers),
        }

        if self.allow_credentials:
            headers["Access-Control-Allow-Credentials"] = "true"

        if self.max_age is not None:
            headers["Access-Control-Max-Age"] = str(self.max_age)

        response = Response(status_code=200, headers=headers)
        await response(scope, receive, send)

    async def _handle_simple_request(
        self,
        request: Request,
        origin: str,
        scope: Scope,
        receive: Receive,
        send: Send,
    ) -> None:
        """Handle a simple (non-preflight) CORS request."""
        # Wrap the send function to inject CORS headers into the response
        original_send = send

        async def send_with_cors(message: Any) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.append(
                    (b"access-control-allow-origin", self._get_allow_origin_header(request).encode())
                )
                if self.allow_credentials:
                    headers.append((b"access-control-allow-credentials", b"true"))
                if self.expose_headers:
                    headers.append(
                        (
                            b"access-control-expose-headers",
                            ", ".join(self.expose_headers).encode(),
                        )
                    )
                message = {**message, "headers": headers}
            await original_send(message)

        await self.app(scope, receive, send_with_cors)

    def _get_allow_origin_header(self, request: Request) -> str:
        """
        Determine the value for the Access-Control-Allow-Origin header.

        If credentials are allowed, we must echo back the specific origin
        rather than using a wildcard.
        """
        if self.allow_credentials:
            origin = request.headers.get("origin", "*")
            return origin
        if self._allow_all_origins and self.allow_origin_func is None:
            return "*"
        return request.headers.get("origin", "*")


# Re-export Awaitable for type hints
from typing import Awaitable  # noqa: E402
