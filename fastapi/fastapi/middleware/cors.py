from __future__ import annotations

import asyncio
import functools
import re
from collections.abc import Callable, Sequence
from typing import Any

from starlette.datastructures import Headers, MutableHeaders
from starlette.middleware.cors import CORSMiddleware as StarletteCORSMiddleware
from starlette.responses import PlainTextResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

ALL_METHODS = ("DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT")
SAFELISTED_HEADERS = {"Accept", "Accept-Language", "Content-Language", "Content-Type"}

# Re-export the original CORSMiddleware so existing imports are unaffected
from starlette.middleware.cors import CORSMiddleware as CORSMiddleware  # noqa


class DynamicCORSMiddleware(StarletteCORSMiddleware):
    """CORS middleware with dynamic origin validation via a callback function.

    Extends the standard Starlette CORSMiddleware to support dynamic origin
    checking through an ``allow_origin_func`` callback. The callback receives
    the origin string from the request and returns ``True`` to allow or
    ``False`` to deny.

    Both synchronous and asynchronous callbacks are supported::

        # Sync callback
        def check_origin(origin: str) -> bool:
            return origin.endswith(".example.com")

        app.add_middleware(
            DynamicCORSMiddleware,
            allow_origin_func=check_origin,
        )

        # Async callback
        async def check_origin_async(origin: str) -> bool:
            result = await db.execute("SELECT 1 FROM allowed_origins WHERE origin = ?", origin)
            return result is not None

        app.add_middleware(
            DynamicCORSMiddleware,
            allow_origin_func=check_origin_async,
        )

    When ``allow_origin_func`` is not provided, the middleware falls back to
    the static ``allow_origins`` list, behaving identically to the standard
    ``CORSMiddleware``.

    Parameters
    ----------
    app:
        The ASGI application.
    allow_origin_func:
        A callable ``(origin: str) -> bool`` (or ``Awaitable[bool]``) used to
        dynamically decide whether a given origin is permitted.  When ``None``
        (the default) the static ``allow_origins`` list is used instead.
    allow_origins:
        Static list of allowed origins (used when *allow_origin_func* is
        ``None``).  Defaults to ``()``.
    allow_methods:
        HTTP methods to allow.  Defaults to ``("GET",)``.
    allow_headers:
        Request headers to allow.  Defaults to ``()``.
    allow_credentials:
        Whether to include the ``Access-Control-Allow-Credentials`` header.
    allow_origin_regex:
        A regex pattern string for matching allowed origins.
    allow_private_network:
        Whether to allow private network access.
    expose_headers:
        Response headers to expose to the browser.
    max_age:
        Max‑age (in seconds) for preflight cache.  Defaults to ``600``.
    cors_max_age:
        Alias for *max_age* that takes precedence when provided.  Convenient
        when the caller prefers the more explicit parameter name.
    """

    def __init__(
        self,
        app: ASGIApp,
        allow_origin_func: Callable[[str], bool | Any] | None = None,
        allow_origins: Sequence[str] = (),
        allow_methods: Sequence[str] = ("GET",),
        allow_headers: Sequence[str] = (),
        allow_credentials: bool = False,
        allow_origin_regex: str | None = None,
        allow_private_network: bool = False,
        expose_headers: Sequence[str] = (),
        max_age: int = 600,
        cors_max_age: int | None = None,
    ) -> None:
        # ``cors_max_age`` takes precedence over ``max_age`` when provided.
        if cors_max_age is not None:
            max_age = cors_max_age

        super().__init__(
            app,
            allow_origins=allow_origins,
            allow_methods=allow_methods,
            allow_headers=allow_headers,
            allow_credentials=allow_credentials,
            allow_origin_regex=allow_origin_regex,
            allow_private_network=allow_private_network,
            expose_headers=expose_headers,
            max_age=max_age,
        )

        self.allow_origin_func = allow_origin_func
        self._func_is_async = (
            asyncio.iscoroutinefunction(allow_origin_func)
            if allow_origin_func is not None
            else False
        )
        self._cors_max_age = max_age

    # ------------------------------------------------------------------
    # Origin validation — overrides the parent to inject the callback
    # ------------------------------------------------------------------

    def is_allowed_origin(self, origin: str) -> bool:  # type: ignore[override]
        """Check whether *origin* is permitted.

        When a dynamic ``allow_origin_func`` has been configured **and** it is
        *synchronous*, it is called directly.  For async callbacks the
        synchronous ``is_allowed_origin`` cannot be awaited, so we fall back to
        the static rules (the async path is handled in ``__call__``).
        """
        if self.allow_origin_func is not None and not self._func_is_async:
            try:
                result = self.allow_origin_func(origin)
                # Guard against async functions being called synchronously.
                if asyncio.iscoroutine(result):
                    result.close()
                    return False
                return bool(result)
            except Exception:
                return False

        # Fall back to the parent's static / regex logic.
        return super().is_allowed_origin(origin)

    async def _is_allowed_origin_async(self, origin: str) -> bool:
        """Async variant of origin validation for async callbacks."""
        if self.allow_origin_func is not None:
            try:
                if self._func_is_async:
                    result = await self.allow_origin_func(origin)  # type: ignore[misc]
                    return bool(result)
                # Synchronous callback — call directly.
                result = self.allow_origin_func(origin)
                return bool(result)
            except Exception:
                return False
        # No dynamic callback — use parent's static / regex logic.
        return bool(super().is_allowed_origin(origin))

    # ------------------------------------------------------------------
    # Request handling — overridden to support async origin checks
    # ------------------------------------------------------------------

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
            response = await self._preflight_response_async(request_headers=headers)
            await response(scope, receive, send)
            return

        await self.simple_response(scope, receive, send, request_headers=headers)

    async def _preflight_response_async(self, request_headers: Headers) -> Response:
        """Build a preflight response using async‑aware origin validation."""
        requested_origin = request_headers["origin"]
        requested_method = request_headers["access-control-request-method"]
        requested_headers = request_headers.get("access-control-request-headers")
        requested_private_network = request_headers.get(
            "access-control-request-private-network"
        )

        headers = dict(self.preflight_headers)
        failures: list[str] = []

        if await self._is_allowed_origin_async(origin=requested_origin):
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
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
        request_headers: Headers,
    ) -> None:
        """Send the simple (non-preflight) response with dynamic origin check."""
        send = functools.partial(
            self.send, send=send, request_headers=request_headers
        )
        await self.app(scope, receive, send)

    async def send(
        self, message: Message, send: Send, request_headers: Headers
    ) -> None:
        """Override ``send`` to apply dynamic origin headers on simple responses."""
        if message["type"] != "http.response.start":
            await send(message)
            return

        message.setdefault("headers", [])
        headers = MutableHeaders(scope=message)
        headers.update(self.simple_headers)
        origin = request_headers["Origin"]

        if self.allow_origin_func is not None:
            # Dynamic mode: check the callback (async-aware).
            if await self._is_allowed_origin_async(origin=origin):
                self.allow_explicit_origin(headers, origin)
        elif self.allow_all_origins and self.allow_credentials:
            self.allow_explicit_origin(headers, origin)
        elif not self.allow_all_origins and self.is_allowed_origin(origin=origin):
            self.allow_explicit_origin(headers, origin)

        await send(message)
