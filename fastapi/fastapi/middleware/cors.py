import inspect
from collections.abc import Awaitable, Callable, Sequence
from contextvars import ContextVar

from starlette.datastructures import Headers
from starlette.middleware.cors import CORSMiddleware as CORSMiddleware  # noqa
from starlette.types import ASGIApp, Receive, Scope, Send

OriginValidator = Callable[[str], bool | Awaitable[bool]]

_dynamic_origin_decisions: ContextVar[dict[int, bool] | None] = ContextVar(
    "_dynamic_origin_decisions", default=None
)


class DynamicCORSMiddleware(CORSMiddleware):
    """CORS middleware with optional per-request origin validation."""

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
        allow_origin_func: OriginValidator | None = None,
        cors_max_age: int | None = None,
    ) -> None:
        self.allow_origin_func = allow_origin_func
        super().__init__(
            app,
            allow_origins=allow_origins,
            allow_methods=allow_methods,
            allow_headers=allow_headers,
            allow_credentials=allow_credentials,
            allow_origin_regex=allow_origin_regex,
            allow_private_network=allow_private_network,
            expose_headers=expose_headers,
            max_age=max_age if cors_max_age is None else cors_max_age,
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if self.allow_origin_func is None or scope["type"] != "http":
            await super().__call__(scope, receive, send)
            return

        headers = Headers(scope=scope)
        origin = headers.get("origin")
        if origin is None:
            await super().__call__(scope, receive, send)
            return

        decisions = dict(_dynamic_origin_decisions.get() or {})
        decisions[id(self)] = await self._allow_dynamic_origin(origin)
        token = _dynamic_origin_decisions.set(decisions)
        try:
            await super().__call__(scope, receive, send)
        finally:
            _dynamic_origin_decisions.reset(token)

    async def _allow_dynamic_origin(self, origin: str) -> bool:
        assert self.allow_origin_func is not None
        result = self.allow_origin_func(origin)
        if inspect.isawaitable(result):
            result = await result
        return bool(result)

    def is_allowed_origin(self, origin: str) -> bool:
        decisions = _dynamic_origin_decisions.get()
        if decisions is not None and id(self) in decisions:
            return decisions[id(self)]
        return super().is_allowed_origin(origin)
