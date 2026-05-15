from __future__ import annotations

import asyncio
from typing import Callable, Awaitable, Union

from starlette.middleware.cors import CORSMiddleware as _CORSMiddleware

# Re-export the existing CORSMiddleware so existing imports are not broken
CORSMiddleware = _CORSMiddleware

__all__ = ["CORSMiddleware", "DynamicCORSMiddleware"]


class DynamicCORSMiddleware:
    """
    CORS middleware that uses a callback to dynamically determine whether to
    allow an incoming origin.

    Works alongside (not instead of) Starlette's built-in CORSMiddleware.

    ## Example

    ```python
    app.add_middleware(
        DynamicCORSMiddleware,
        allow_origin_func=lambda origin: origin.startswith("https://"),
        cors_max_age=600,
    )
    ```

    Parameters
    ----------
    app : ASGIApp
        The next app in the stack.
    allow_origin_func : Callable[[str], bool] | Callable[[str], Awaitable[bool]]
        Called with the ``Origin`` header value. Should return ``True`` to allow.
        Supports both sync and async callables.
    allow_methods : list[str]
        Allowed HTTP methods for CORS preflight.
    allow_headers : list[str]
        Allowed request headers.
    allow_credentials : bool
        Whether to set ``Access-Control-Allow-Credentials``.
    expose_headers : list[str]
        Headers to expose.
    cors_max_age : int | None
        Sets the ``Access-Control-Max-Age`` preflight response header.
    """

    def __init__(
        self,
        app: "ASGIApp",
        *,
        allow_origin_func: Callable[[str], bool] | Callable[[str], Awaitable[bool]],
        allow_methods: list[str] = ["GET", "POST", "HEAD", "OPTIONS"],
        allow_headers: list[str] = ["*"],
        allow_credentials: bool = False,
        expose_headers: list[str] | None = None,
        cors_max_age: int | None = None,
    ) -> None:
        self.app = app
        self.allow_origin_func = allow_origin_func
        self.allow_methods = allow_methods
        self.allow_headers = allow_headers
        self.allow_credentials = allow_credentials
        self.expose_headers = expose_headers or []
        self.cors_max_age = cors_max_age

    async def __call__(self, scope: dict, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Only intercept OPTIONS preflight requests with an Origin header
        if scope.get("method") == "OPTIONS":
            headers = {k.decode(): v.decode() for k, v in scope.get("headers", [])}
            origin = headers.get("origin", "")

            if origin:
                is_allowed = self.allow_origin_func(origin)
                if asyncio.iscoroutine(is_allowed):
                    is_allowed = await is_allowed

                if not is_allowed:
                    # Deny preflight with 400
                    await send(
                        {
                            "type": "http.response.start",
                            "status": 400,
                            "headers": [
                                (b"content-type", b"text/plain"),
                            ],
                        }
                    )
                    await send({"type": "http.response.body", "body": b"Origin not allowed by CORS policy"})
                    return

                # Build CORS response headers
                response_headers = [
                    (b"access-control-allow-origin", origin.encode()),
                    (b"access-control-allow-methods", ",".join(m.encode() for m in self.allow_methods).encode()),
                    (b"access-control-allow-headers", ",".join(h.encode() for h in self.allow_headers).encode()),
                ]
                if self.allow_credentials:
                    response_headers.append((b"access-control-allow-credentials", b"true"))
                if self.expose_headers:
                    response_headers.append(
                        (b"access-control-expose-headers", ",".join(h.encode() for h in self.expose_headers).encode())
                    )
                if self.cors_max_age is not None:
                    response_headers.append(
                        (b"access-control-max-age", str(self.cors_max_age).encode())
                    )

                await send({"type": "http.response.start", "status": 200, "headers": response_headers})
                await send({"type": "http.response.body", "body": b""})
                return

        await self.app(scope, receive, send)