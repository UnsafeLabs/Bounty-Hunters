import inspect
import typing
from contextvars import ContextVar

from starlette.datastructures import Headers
from starlette.middleware.cors import CORSMiddleware as CORSMiddleware  # noqa
from starlette.types import ASGIApp, Receive, Scope, Send

AllowOriginFunc = typing.Callable[[str], typing.Union[bool, typing.Awaitable[bool]]]

# Stores the ``allow_origin_func`` decision for the origin of the request that is
# currently being handled. ``CORSMiddleware`` checks the origin from synchronous
# helpers (``is_allowed_origin``), so an async callback cannot be awaited there.
# Resolving the decision once in ``__call__`` and exposing it through a
# ``ContextVar`` keeps it request-scoped and safe under concurrency.
_allow_origin_decision: ContextVar[typing.Optional[bool]] = ContextVar(
    "fastapi_dynamic_cors_allow_origin_decision", default=None
)


class DynamicCORSMiddleware(CORSMiddleware):
    """CORS middleware that can validate origins dynamically per request.

    It extends Starlette's :class:`CORSMiddleware`, reusing its preflight and
    simple-response handling (including credentials and ``Access-Control-*``
    headers), and only swaps the origin check for a user supplied callback.

    Args:
        allow_origin_func: Callback that receives the request ``Origin`` and
            returns a truthy value to allow it or a falsy value to deny it. It
            may be synchronous or asynchronous (an awaitable result is awaited).
            When ``None``, the middleware falls back to the static
            ``allow_origins`` / ``allow_origin_regex`` behaviour.
        cors_max_age: Convenience alias for ``max_age``; when provided it sets
            the ``Access-Control-Max-Age`` header used in preflight responses.
    """

    def __init__(
        self,
        app: ASGIApp,
        allow_origins: typing.Sequence[str] = (),
        allow_methods: typing.Sequence[str] = ("GET",),
        allow_headers: typing.Sequence[str] = (),
        allow_credentials: bool = False,
        allow_origin_regex: typing.Optional[str] = None,
        expose_headers: typing.Sequence[str] = (),
        max_age: int = 600,
        *,
        allow_origin_func: typing.Optional[AllowOriginFunc] = None,
        cors_max_age: typing.Optional[int] = None,
    ) -> None:
        if cors_max_age is not None:
            max_age = cors_max_age
        super().__init__(
            app,
            allow_origins=allow_origins,
            allow_methods=allow_methods,
            allow_headers=allow_headers,
            allow_credentials=allow_credentials,
            allow_origin_regex=allow_origin_regex,
            expose_headers=expose_headers,
            max_age=max_age,
        )
        self.allow_origin_func = allow_origin_func
        self.cors_max_age = max_age

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or self.allow_origin_func is None:
            await super().__call__(scope, receive, send)
            return

        origin = Headers(scope=scope).get("origin")
        if origin is None:
            await self.app(scope, receive, send)
            return

        token = _allow_origin_decision.set(await self._resolve_origin(origin))
        try:
            await super().__call__(scope, receive, send)
        finally:
            _allow_origin_decision.reset(token)

    async def _resolve_origin(self, origin: str) -> bool:
        func = self.allow_origin_func
        assert func is not None
        result = func(origin)
        if inspect.isawaitable(result):
            return bool(await result)
        return bool(result)

    def is_allowed_origin(self, origin: str) -> bool:
        decision = _allow_origin_decision.get()
        if decision is not None:
            return decision
        return super().is_allowed_origin(origin)
