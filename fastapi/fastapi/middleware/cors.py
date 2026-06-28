import inspect
from collections.abc import Awaitable, Callable, Sequence
from contextvars import ContextVar
from typing import cast

from starlette.middleware.cors import CORSMiddleware as CORSMiddleware  # noqa
from starlette.types import ASGIApp, Receive, Scope, Send

OriginDecision = tuple[str, bool]
AllowOriginFunc = Callable[[str], bool | Awaitable[bool]]

_dynamic_origin_decision: ContextVar[OriginDecision | None] = ContextVar(
    "fastapi_dynamic_cors_origin_decision",
    default=None,
)


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
        max_age: int = 600,
        allow_origin_func: AllowOriginFunc | None = None,
        cors_max_age: int | None = None,
    ) -> None:
        self.allow_origin_func = allow_origin_func
        if cors_max_age is not None:
            max_age = cors_max_age

        super().__init__(
            app,
            allow_origins=() if allow_origin_func is not None else allow_origins,
            allow_methods=allow_methods,
            allow_headers=allow_headers,
            allow_credentials=allow_credentials,
            allow_origin_regex=None
            if allow_origin_func is not None
            else allow_origin_regex,
            allow_private_network=allow_private_network,
            expose_headers=expose_headers,
            max_age=max_age,
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or self.allow_origin_func is None:
            await super().__call__(scope, receive, send)
            return

        origin = None
        for header_name, header_value in scope["headers"]:
            if header_name == b"origin":
                origin = header_value.decode("latin-1")
                break

        if origin is None:
            await super().__call__(scope, receive, send)
            return

        allowed = await self._is_origin_allowed_by_func(origin)
        token = _dynamic_origin_decision.set((origin, allowed))
        try:
            await super().__call__(scope, receive, send)
        finally:
            _dynamic_origin_decision.reset(token)

    async def _is_origin_allowed_by_func(self, origin: str) -> bool:
        assert self.allow_origin_func is not None
        result = self.allow_origin_func(origin)
        if inspect.isawaitable(result):
            result = await cast(Awaitable[bool], result)
        return bool(result)

    def is_allowed_origin(self, origin: str) -> bool:
        decision = _dynamic_origin_decision.get()
        if decision is not None and decision[0] == origin:
            return decision[1]

        return super().is_allowed_origin(origin)
