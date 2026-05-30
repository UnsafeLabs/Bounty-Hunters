"""Dynamic CORS middleware with callback-based origin validation."""

from typing import Callable, List, Optional, Sequence, Set, Union
import asyncio
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send


ALL_METHODS = ("DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT")
SAFELISTED_HEADERS = {"accept", "accept-language", "content-language", "content-type"}


class DynamicCORSMiddleware:
    """CORS middleware that supports dynamic origin validation via callback.

    Supports both sync and async callback functions for runtime origin checking.
    Falls back to a static allow_origins list when no callback is provided.

    Args:
        app: The ASGI application.
        allow_origin_func: A callable that receives an origin string and returns
            True to allow or False to deny. Can be sync or async.
        allow_origins: Static list of allowed origins (used as fallback when
            allow_origin_func is not provided). Use ["*"] to allow all.
        allow_methods: List of allowed HTTP methods. Defaults to GET.
        allow_headers: List of allowed request headers.
        allow_credentials: Whether to allow credentials.
        expose_headers: Headers to expose to the browser.
        cors_max_age: Max-Age in seconds for preflight cache.
    """

    def __init__(
        self,
        app: ASGIApp,
        allow_origin_func: Optional[Callable[[str], Union[bool, "asyncio.coroutine"]]] = None,
        allow_origins: Sequence[str] = (),
        allow_methods: Sequence[str] = ("GET",),
        allow_headers: Sequence[str] = (),
        allow_credentials: bool = False,
        expose_headers: Sequence[str] = (),
        cors_max_age: int = 600,
    ):
        self.app = app
        self.allow_origin_func = allow_origin_func
        self.allow_origins: Set[str] = set(allow_origins)
        self.allow_all_origins = "*" in allow_origins
        self.allow_methods = ALL_METHODS if "*" in allow_methods else tuple(m.upper() for m in allow_methods)
        self.allow_all_headers = "*" in allow_headers
        self.allow_headers = sorted(SAFELISTED_HEADERS | {h.lower() for h in allow_headers})
        self.allow_credentials = allow_credentials
        self.expose_headers = list(expose_headers)
        self.max_age = cors_max_age

        # Prebuild simple response headers
        self.simple_headers: dict[str, str] = {}
        if self.allow_all_origins:
            self.simple_headers["Access-Control-Allow-Origin"] = "*"
        if allow_credentials:
            self.simple_headers["Access-Control-Allow-Credentials"] = "true"
        if expose_headers:
            self.simple_headers["Access-Control-Expose-Headers"] = ", ".join(expose_headers)

        # Prebuild preflight headers
        self.preflight_headers: dict[str, str] = {
            "Access-Control-Allow-Methods": ", ".join(self.allow_methods),
            "Access-Control-Max-Age": str(self.max_age),
        }
        if self.allow_all_origins and not allow_credentials:
            self.preflight_headers["Access-Control-Allow-Origin"] = "*"
        else:
            self.preflight_headers["Vary"] = "Origin"
        if self.allow_headers and not self.allow_all_headers:
            self.preflight_headers["Access-Control-Allow-Headers"] = ", ".join(self.allow_headers)
        if allow_credentials:
            self.preflight_headers["Access-Control-Allow-Credentials"] = "true"

    def _is_origin_allowed(self, origin: str) -> bool:
        """Check if origin is allowed (sync check)."""
        if self.allow_all_origins:
            return True
        return origin in self.allow_origins

    async def _check_origin(self, origin: str) -> bool:
        """Check origin via callback or static list."""
        if self.allow_origin_func is None:
            return self._is_origin_allowed(origin)

        result = self.allow_origin_func(origin)
        if asyncio.iscoroutine(result) or asyncio.isfuture(result):
            return await result
        return bool(result)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            method = scope.get("method", "").upper()
            origin = None
            for header_name, header_value in scope.get("headers", []):
                if header_name == b"origin":
                    origin = header_value.decode("utf-8")
                    break

            if origin is not None:
                allowed = await self._check_origin(origin)

                if method == "OPTIONS":
                    # Preflight request
                    if allowed:
                        headers = dict(self.preflight_headers)
                        if not self.allow_all_origins or self.allow_credentials:
                            headers["Access-Control-Allow-Origin"] = origin
                        await send({
                            "type": "http.response.start",
                            "status": 200,
                            "headers": [(k.encode(), v.encode()) for k, v in headers.items()],
                        })
                        await send({"type": "http.response.body", "body": b""})
                        return
                    else:
                        await send({
                            "type": "http.response.start",
                            "status": 403,
                            "headers": [(b"content-length", b"0")],
                        })
                        await send({"type": "http.response.body", "body": b""})
                        return

                elif allowed:
                    # Simple request with allowed origin
                    async def send_with_cors(message: Message) -> None:
                        if message["type"] == "http.response.start":
                            headers = MutableHeaders(scope=message)
                            for k, v in self.simple_headers.items():
                                headers[k] = v
                            if not self.allow_all_origins:
                                headers["Access-Control-Allow-Origin"] = origin
                                # Vary: Origin for non-wildcard origins
                        await send(message)

                    await self.app(scope, receive, send_with_cors)
                    return

        await self.app(scope, receive, send)
