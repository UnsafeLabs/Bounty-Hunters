"""
Dynamic CORS middleware that allows runtime origin validation via a callback.
"""

from __future__ import annotations

import inspect
import re
import typing
from starlette.datastructures import Headers
from starlette.middleware.cors import CORSMiddleware as CORSMiddleware
from starlette.requests import Request
from starlette.types import ASGIApp, Receive, Scope, Send

# Import constants from starlette.middleware.cors
try:
    from starlette.middleware.cors import SAFELISTED_HEADERS, ALL_METHODS
except ImportError:
    SAFELISTED_HEADERS = {h.lower() for h in ["Accept", "Accept-Language", "Content-Language", "Content-Type"]}
    ALL_METHODS = ("GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS")


class DynamicCORSMiddleware:
    """
    CORS middleware that supports dynamic origin validation via a callback function.

    Unlike the standard CORSMiddleware which uses a static list of allowed origins,
    this middleware accepts an ``allow_origin_func`` callback that receives the
    incoming origin string and returns True/False to dynamically allow or deny it.

    The callback can be sync or async:

    .. code-block:: python

        # Synchronous callback
        def allow_origin(origin: str) -> bool:
            return origin.endswith(".example.com")

        # Asynchronous callback
        async def allow_origin_async(origin: str) -> bool:
            # Could check a database or cache
            return await is_origin_allowed(origin)

        app.add_middleware(
            DynamicCORSMiddleware,
            allow_origin_func=allow_origin,
            allow_methods=["GET", "POST"],
            allow_headers=["Content-Type"],
            cors_max_age=3600,
        )

    When ``allow_origin_func`` is not provided, it falls back to the standard
    ``allow_origins`` list behavior.
    """

    def __init__(
        self,
        app: ASGIApp,
        *,
        allow_origin_func: typing.Callable[[str], bool | typing.Awaitable[bool]] | None = None,
        allow_origins: typing.Sequence[str] = (),
        allow_methods: typing.Sequence[str] = ("GET",),
        allow_headers: typing.Sequence[str] = (),
        allow_credentials: bool = False,
        allow_origin_regex: str | None = None,
        allow_private_network: bool = False,
        expose_headers: typing.Sequence[str] = (),
        cors_max_age: int = 600,
    ) -> None:
        self.app = app
        self.allow_origin_func = allow_origin_func
        self.allow_origins = allow_origins
        self.allow_methods = allow_methods
        self.allow_headers = [h.lower() for h in allow_headers]
        self.allow_credentials = allow_credentials
        self.allow_origin_regex = (
            re.compile(allow_origin_regex) if allow_origin_regex else None
        )
        self.allow_private_network = allow_private_network
        self.expose_headers = expose_headers
        self.cors_max_age = cors_max_age

        # Pre-compute standard middleware for fallback and header building
        self._standard_middleware = CORSMiddleware(
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

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        origin = headers.get("origin")

        if origin is None:
            # Not a CORS request, pass through
            await self.app(scope, receive, send)
            return

        # Check if origin is allowed via callback or standard rules
        allowed = await self._is_origin_allowed(origin)

        if not allowed:
            await self.app(scope, receive, send)
            return

        # Handle preflight
        if scope["method"] == "OPTIONS":
            await self._handle_preflight(scope, receive, send, origin)
            return

        # Regular request - add CORS headers
        async def wrapped_send(message: typing.MutableMapping) -> None:
            if message["type"] == "http.response.start":
                # Build headers for this origin
                response_headers = self._build_response_headers(origin)
                original_headers = message.get("headers", ())
                message["headers"] = tuple(original_headers) + tuple(
                    (k.encode(), v.encode()) for k, v in response_headers.items()
                )
            await send(message)

        await self.app(scope, receive, wrapped_send)

    async def _is_origin_allowed(self, origin: str) -> bool:
        """Check if the given origin is allowed."""
        # Try callback first
        if self.allow_origin_func is not None:
            result = self.allow_origin_func(origin)
            if inspect.isawaitable(result):
                result = await result
            if result:
                return True

        # Fall back to standard origin matching (replicate Starlette logic)
        if "*" in self.allow_origins:
            return True
        if origin in self.allow_origins:
            return True
        if self.allow_origin_regex and self.allow_origin_regex.match(origin):
            return True
        return False

    def _build_response_headers(self, origin: str) -> dict[str, str]:
        """Build CORS response headers for the given origin."""
        headers: dict[str, str] = {}

        # Set the actual origin (not wildcard) when credentials are involved
        if self.allow_credentials:
            headers["Access-Control-Allow-Origin"] = origin
            headers["Access-Control-Allow-Credentials"] = "true"
            headers["Vary"] = "Origin"
        else:
            headers["Access-Control-Allow-Origin"] = origin

        if self.expose_headers:
            headers["Access-Control-Expose-Headers"] = ", ".join(self.expose_headers)

        return headers

    async def _handle_preflight(
        self, scope: Scope, receive: Receive, send: Send, origin: str
    ) -> None:
        """Handle CORS preflight request."""
        headers = Headers(scope=scope)
        request_method = headers.get("Access-Control-Request-Method", "GET")
        request_headers = headers.get("Access-Control-Request-Headers", "")

        # Check if method is allowed
        method_allowed = (
            "*" in self.allow_methods
            or request_method in self.allow_methods
        )

        # Check if headers are allowed
        request_headers_list = [h.strip().lower() for h in request_headers.split(",") if h.strip()]
        headers_allowed = True
        if request_headers_list and "*" not in self.allow_headers:
            headers_allowed = all(
                h in self.allow_headers or h in SAFELISTED_HEADERS
                for h in request_headers_list
            )

        if not method_allowed or not headers_allowed:
            await self.app(scope, receive, send)
            return

        # Build preflight response
        async def send_preflight(message: typing.MutableMapping) -> None:
            if message["type"] == "http.response.start":
                response_headers = {
                    "Access-Control-Allow-Origin": origin,
                    "Access-Control-Allow-Methods": ", ".join(self.allow_methods),
                    "Access-Control-Max-Age": str(self.cors_max_age),
                }

                if request_headers:
                    allowed_headers = sorted(
                        set(self.allow_headers) | SAFELISTED_HEADERS
                    )
                    response_headers["Access-Control-Allow-Headers"] = ", ".join(
                        allowed_headers
                    )

                if self.allow_credentials:
                    response_headers["Access-Control-Allow-Credentials"] = "true"
                    response_headers["Vary"] = "Origin"

                original_headers = message.get("headers", ())
                message["headers"] = tuple(original_headers) + tuple(
                    (k.encode(), v.encode()) for k, v in response_headers.items()
                )

                # Set 204 No Content for preflight
                message["status"] = 204

            await send(message)

        # Send empty response
        await send({"type": "http.response.start", "status": 204, "headers": []})
        await send({"type": "http.response.body", "body": b""})
