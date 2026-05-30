from collections.abc import Awaitable, Callable, Sequence
from contextvars import ContextVar
from inspect import isawaitable

from starlette.datastructures import Headers
from starlette.middleware.cors import CORSMiddleware as CORSMiddleware  # noqa
from starlette.types import ASGIApp, Receive, Scope, Send

OriginValidator = Callable[[str], bool | Awaitable[bool]]


class DynamicCORSMiddleware(CORSMiddleware):
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
        max_age: int | None = None,
        allow_origin_func: OriginValidator | None = None,
        cors_max_age: int = 600,
    ) -> None:
        self.allow_origin_func = allow_origin_func
        self._origin_decision: ContextVar[tuple[str, bool] | None] = ContextVar(
            "dynamic_cors_origin_decision",
            default=None,
        )

        if max_age is not None:
            cors_max_age = max_age

        # A dynamic validator must be authoritative. Passing an empty static
        # allow list prevents wildcard headers from bypassing callback denials.
        static_allow_origins = () if allow_origin_func is not None else allow_origins
        super().__init__(
            app=app,
            allow_origins=static_allow_origins,
            allow_methods=allow_methods,
            allow_headers=allow_headers,
            allow_credentials=allow_credentials,
            allow_origin_regex=allow_origin_regex,
            allow_private_network=allow_private_network,
            expose_headers=expose_headers,
            max_age=cors_max_age,
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

        allowed = await self._resolve_origin(origin)
        token = self._origin_decision.set((origin, allowed))
        try:
            await super().__call__(scope, receive, send)
        finally:
            self._origin_decision.reset(token)

    def is_allowed_origin(self, origin: str) -> bool:
        if self.allow_origin_func is None:
            return super().is_allowed_origin(origin)

        decision = self._origin_decision.get()
        if decision is not None and decision[0] == origin:
            return decision[1]

        result = self.allow_origin_func(origin)
        if isawaitable(result):
            raise RuntimeError(
                "Async allow_origin_func must be evaluated during an ASGI request"
            )

        return bool(result)

    async def _resolve_origin(self, origin: str) -> bool:
        assert self.allow_origin_func is not None

        result = self.allow_origin_func(origin)
        if isawaitable(result):
            result = await result

        return bool(result)
