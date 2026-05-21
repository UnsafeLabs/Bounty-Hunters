from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable, Sequence

from starlette.datastructures import Headers
from starlette.middleware.cors import CORSMiddleware as CORSMiddleware  # noqa
from starlette.types import ASGIApp, Receive, Scope, Send


class DynamicCORSMiddleware(CORSMiddleware):
    """
    CORSMiddleware with support for a dynamic callback to validate origins.

    Extends Starlette's CORSMiddleware by accepting an optional
    ``allow_origin_func`` callback.  The callback receives the request
    ``Origin`` string and returns ``True`` (allow) or ``False`` (deny).
    Both sync and async callables are supported.

    When ``allow_origin_func`` is ``None`` (the default) the middleware
    behaves identically to the parent ``CORSMiddleware``.
    """

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
        allow_origin_func: Callable[[str], bool | Awaitable[bool]] | None = None,
        cors_max_age: int | None = None,
    ) -> None:
        self.allow_origin_func = allow_origin_func
        self._origin_cache: dict[str, bool] = {}

        if cors_max_age is not None:
            max_age = cors_max_age

        super().__init__(
            app=app,
            allow_origins=allow_origins,
            allow_methods=allow_methods,
            allow_headers=allow_headers,
            allow_credentials=allow_credentials,
            allow_origin_regex=allow_origin_regex,
            allow_private_network=allow_private_network,
            expose_headers=expose_headers,
            max_age=max_age,
        )

    # ------------------------------------------------------------------
    # Origin checking
    # ------------------------------------------------------------------

    def is_allowed_origin(self, origin: str) -> bool:
        cached = self._origin_cache.get(origin)
        if cached is not None:
            return cached

        if super().is_allowed_origin(origin):
            return True

        if self.allow_origin_func is not None:
            result = self.allow_origin_func(origin)
            if inspect.isawaitable(result):
                raise RuntimeError(
                    f"Async allow_origin_func was invoked for origin={origin!r} "
                    f"in a synchronous context (is_allowed_origin). "
                    f"The middleware resolves async callbacks in __call__ "
                    f"before they reach this path; this error suggests the "
                    f"cache was bypassed or the middleware is being used "
                    f"outside the normal ASGI flow."
                )
            allowed = bool(result)
            self._origin_cache[origin] = allowed
            return allowed

        return False

    async def __call__(
        self, scope: Scope, receive: Receive, send: Send
    ) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        method = scope["method"]
        headers = Headers(scope=scope)
        origin = headers.get("origin")

        if origin is None:
            await self.app(scope, receive, send)
            return

        # Resolve async callbacks early and cache the result so that the
        # synchronous is_allowed_origin path can find it.
        if self.allow_origin_func is not None and origin not in self._origin_cache:
            result = self.allow_origin_func(origin)
            if inspect.isawaitable(result):
                result = await result
            self._origin_cache[origin] = bool(result)

        if method == "OPTIONS" and "access-control-request-method" in headers:
            response = self.preflight_response(request_headers=headers)
            await response(scope, receive, send)
            return

        await self.simple_response(scope, receive, send, request_headers=headers)
