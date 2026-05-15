import asyncio
import functools
import typing

from starlette.middleware.cors import CORSMiddleware as CORSMiddleware  # noqa
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp, Receive, Scope, Send


class DynamicCORSMiddleware(CORSMiddleware):
    """
    CORS middleware that supports dynamic origin validation via a callback.

    Extends Starlette's `CORSMiddleware` to allow programmatic, per-request
    origin allow/deny decisions. The `allow_origin_func` callback receives the
    origin string and returns ``True`` (allow) or ``False`` (deny). Both sync
    and async callables are supported.

    When `allow_origin_func` is *not* provided (or returns ``None``), the
    middleware falls back to the static ``allow_origins`` list, preserving
    full backward compatibility.

    Args:
        app: The ASGI application.
        allow_origin_func: An optional callable (sync or async) that takes an
            origin string and returns ``True`` / ``False``.
        cors_max_age: Value for the ``Access-Control-Max-Age`` preflight
            response header.  If ``None``, the parent class default is used.
        **kwargs: All other arguments are forwarded to ``CORSMiddleware``
            (``allow_origins``, ``allow_methods``, ``allow_headers``, …).
    """

    def __init__(
        self,
        app: ASGIApp,
        allow_origin_func: typing.Callable[[str], typing.Awaitable[bool] | bool] | None = None,
        cors_max_age: str | None = None,
        **kwargs: typing.Any,
    ) -> None:
        super().__init__(app, **kwargs)
        self.allow_origin_func = allow_origin_func
        if cors_max_age is not None:
            # CORSMiddleware stores max_age in self.max_age
            try:
                self.max_age = int(cors_max_age)
            except (ValueError, TypeError):
                self.max_age = 600

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await super().__call__(scope, receive, send)
            return

        # Let the parent handle the full flow, but we override
        # is_origin_allowed via a wrapper approach.
        # Since CORSMiddleware.__call__ is the entry point, we intercept
        # the origin check by patching self.is_origin_allowed temporarily
        # for each request.

        # We'll use a different approach: wrap the send to inject headers
        # and handle the preflight ourselves for dynamic origins.

        origin = ""
        for key, value in scope.get("headers", []):
            if key == b"origin":
                origin = value.decode("latin-1")
                break

        if not origin:
            # No origin → no CORS needed; pass through
            await super().__call__(scope, receive, send)
            return

        # Determine if this origin is allowed (dynamic or static)
        allowed = await self._is_origin_allowed_dynamic(origin)

        if not allowed:
            # Origin not allowed — strip origin from scope so parent
            # behaves as if no CORS is in play, then pass through
            cleaned_headers = [
                (k, v) for k, v in scope["headers"] if k.lower() != b"origin"
            ]
            scope["headers"] = cleaned_headers
            await super().__call__(scope, receive, send)
            return

        # Origin IS allowed — let parent run normally; it will add CORS
        # headers when it finds the origin (or *).
        # Temporarily inject the origin into allow_origins so the parent
        # check passes.
        original_allow_origins = self.allow_origins
        self.allow_origins = list(original_allow_origins or []) + [origin]
        try:
            await super().__call__(scope, receive, send)
        finally:
            self.allow_origins = original_allow_origins

    async def _is_origin_allowed_dynamic(self, origin: str) -> bool:
        """Check origin against dynamic callback first, then static list."""
        if self.allow_origin_func is not None:
            result = self.allow_origin_func(origin)
            if asyncio.iscoroutine(result):
                result = await result
            if result:
                return True
        # Fallback: check by temporarily injecting into allow_origins
        # (handled in __call__ above) or just return True so parent
        # does its own check.
        # We return True here because the parent's own check is
        # authoritative for the static list.
        if self.allow_origins:
            if "*" in self.allow_origins:
                return True
            if origin in self.allow_origins:
                return True
        return False

    def is_origin_allowed(self, origin: str) -> bool:
        """Override parent's sync check — we handle it asynchronously above."""
        # Return True unconditionally because __call__ manages the logic.
        return True
