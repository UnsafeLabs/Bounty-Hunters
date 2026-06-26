from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable, Sequence
from contextvars import ContextVar

from starlette.middleware.cors import CORSMiddleware as CORSMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send

AllowOriginFunc = Callable[[str], bool | Awaitable[bool]]


class DynamicCORSMiddleware(CORSMiddleware):
    _origin_decisions: ContextVar[dict[str, bool] | None] = ContextVar(
        "dynamic_cors_origin_decisions",
        default=None,
    )

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
        if allow_origin_func is None:
            dynamic_allow_origins = allow_origins
            dynamic_allow_origin_regex = allow_origin_regex
        else:
            dynamic_allow_origins = ()
            dynamic_allow_origin_regex = None

        super().__init__(
            app,
            allow_origins=dynamic_allow_origins,
            allow_methods=allow_methods,
            allow_headers=allow_headers,
            allow_credentials=allow_credentials,
            allow_origin_regex=dynamic_allow_origin_regex,
            allow_private_network=allow_private_network,
            expose_headers=expose_headers,
            max_age=max_age if cors_max_age is None else cors_max_age,
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if self.allow_origin_func is None or scope["type"] != "http":
            await super().__call__(scope, receive, send)
            return

        origin = None
        for name, value in scope["headers"]:
            if name == b"origin":
                origin = value.decode("latin-1")
                break

        if origin is None:
            await super().__call__(scope, receive, send)
            return

        is_allowed = await self._is_origin_allowed_by_callback(origin)
        token = self._origin_decisions.set({origin: is_allowed})
        try:
            await super().__call__(scope, receive, send)
        finally:
            self._origin_decisions.reset(token)

    def is_allowed_origin(self, origin: str) -> bool:
        decisions = self._origin_decisions.get()
        if decisions is not None and origin in decisions:
            return decisions[origin]
        return super().is_allowed_origin(origin)

    async def _is_origin_allowed_by_callback(self, origin: str) -> bool:
        assert self.allow_origin_func is not None
        result = self.allow_origin_func(origin)
        if inspect.isawaitable(result):
            result = await result
        return bool(result)


__all__ = ["CORSMiddleware", "DynamicCORSMiddleware"]
