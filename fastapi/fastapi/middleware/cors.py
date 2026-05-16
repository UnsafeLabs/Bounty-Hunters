import asyncio
import typing

from starlette.middleware.cors import CORSMiddleware as CORSMiddleware  # noqa: F401
from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class DynamicCORSMiddleware(CORSMiddleware):
    """CORS middleware that supports dynamic origin validation via a callback.

    Extends Starlette's ``CORSMiddleware`` to allow per-request, programmatic
    origin allow/deny decisions.  The ``allow_origin_func`` callback receives
    the origin string and returns ``True`` (allow) or ``False`` (deny).
    Both sync and async callables are supported.

    When ``allow_origin_func`` is ``None`` (the default), behaviour is
    identical to the parent ``CORSMiddleware`` — a no-op extension point.

    Args:
        app: The ASGI application.
        allow_origin_func: An optional callable (sync or async) that takes an
            origin string and returns ``True`` / ``False``.
        cors_max_age: Value for the ``Access-Control-Max-Age`` preflight
            response header.  When ``None`` the parent's ``max_age`` default
            (600) is used.
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
        self.allow_origin_func = allow_origin_func
        # Forward cors_max_age as the parent's max_age parameter so that it is
        # baked into ``self.preflight_headers`` during init (Starlette builds
        # the preflight header dict once at construction time).
        if cors_max_age is not None:
            kwargs["max_age"] = int(cors_max_age)
        super().__init__(app, **kwargs)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        origin = headers.get("origin")

        if origin is None:
            await self.app(scope, receive, send)
            return

        # --- Dynamic origin check -------------------------------------------
        dynamic_allowed: bool | None = None

        if self.allow_origin_func is not None:
            result = self.allow_origin_func(origin)
            if asyncio.iscoroutine(result):
                result = await result
            dynamic_allowed = result

        # Case 1: dynamically denied AND not statically allowed → block origin
        if dynamic_allowed is False:
            if origin not in self.allow_origins and not (
                self.allow_all_origins or
                (self.allow_origin_regex is not None and self.allow_origin_regex.fullmatch(origin))
            ):
                # Neither dynamic nor static allows it — pass through without
                # modifying self.allow_origins.  The parent's
                # ``is_allowed_origin`` will naturally reject it.
                await super().__call__(scope, receive, send)
                return

            # Dynamic says deny but static says allow → temporarily remove
            # origin from the static list so the parent sees the denial.
            if origin in self.allow_origins:
                original: typing.Sequence[str] = self.allow_origins
                self.allow_origins = tuple(o for o in self.allow_origins if o != origin)
                try:
                    await super().__call__(scope, receive, send)
                finally:
                    self.allow_origins = original
                return

            # Falls through: origin wasn't in allow_origins but matched regex
            # or allow_all_origins — treat as denied.
            await super().__call__(scope, receive, send)
            return

        # Case 2: dynamically allowed AND not already in static list
        if dynamic_allowed is True and origin not in self.allow_origins:
            original = self.allow_origins
            self.allow_origins = tuple(self.allow_origins) + (origin,)
            try:
                await super().__call__(scope, receive, send)
            finally:
                self.allow_origins = original
            return

        # Case 3: no override needed (callback returned None, or origin is
        # already covered by static rules, or no callback configured).
        await super().__call__(scope, receive, send)
