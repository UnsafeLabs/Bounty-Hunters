from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable, Sequence
from contextvars import ContextVar

from starlette.datastructures import Headers, MutableHeaders
from starlette.middleware.cors import CORSMiddleware as CORSMiddleware  # noqa
from starlette.types import ASGIApp, Message, Receive, Scope, Send

OriginValidator = Callable[[str], bool | Awaitable[bool]]


class DynamicCORSMiddleware(CORSMiddleware):
    """CORS middleware that decides allowed origins from a callback.

    Instead of matching each incoming ``Origin`` against a fixed list, this
    passes it to ``allow_origin_func`` and trusts the returned boolean. The
    callback may be synchronous or return an awaitable. When no callback is
    given the behaviour falls back to the standard ``allow_origins`` list.

    Args:
        allow_origin_func: Receives the origin and returns whether it is
            allowed. May be a coroutine function.
        cors_max_age: Value for the ``Access-Control-Max-Age`` preflight
            header. Overrides ``max_age`` when provided.
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
        allow_origin_func: OriginValidator | None = None,
        cors_max_age: int | None = None,
    ) -> None:
        if allow_origin_func is not None and "*" in allow_origins:
            raise ValueError(
                "allow_origin_func cannot be combined with a wildcard '*' in "
                "allow_origins: the wildcard makes the parent middleware allow "
                "every origin without consulting the callback. Drop the '*' and "
                "let the callback be the sole origin gate."
            )

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
        # Per-instance so that stacked middleware instances keep independent
        # decisions. It carries the resolved allow/deny for the origin of the
        # request currently in flight, letting the synchronous
        # is_allowed_origin() hook read a value an async callback produced.
        self._origin_decision: ContextVar[tuple[str, bool] | None] = ContextVar(
            "dynamic_cors_origin_decision", default=None
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or self.allow_origin_func is None:
            await super().__call__(scope, receive, send)
            return

        origin = Headers(scope=scope).get("origin")
        if origin is None:
            await super().__call__(scope, receive, send)
            return

        allowed = await self._resolve_origin(origin)
        token = self._origin_decision.set((origin, allowed))
        try:
            await super().__call__(scope, receive, send)
        finally:
            self._origin_decision.reset(token)

    async def send(
        self, message: Message, send: Send, request_headers: Headers
    ) -> None:
        if self.allow_origin_func is None:
            await super().send(message, send=send, request_headers=request_headers)
            return

        async def send_with_vary(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                # A dynamic policy returns different CORS results for the same
                # URL depending on the origin, including the denied case where
                # no Access-Control-Allow-Origin is set. Always vary on Origin
                # so shared caches never serve a denied response to an allowed
                # origin (or vice versa). The parent already adds this when it
                # echoes an allowed origin, so guard against duplicating it.
                existing = [
                    v.strip().lower() for v in headers.get("vary", "").split(",")
                ]
                if "origin" not in existing:
                    headers.add_vary_header("Origin")
            await send(message)

        await super().send(
            message, send=send_with_vary, request_headers=request_headers
        )

    async def _resolve_origin(self, origin: str) -> bool:
        assert self.allow_origin_func is not None
        result = self.allow_origin_func(origin)
        if inspect.isawaitable(result):
            result = await result
        return bool(result)

    def is_allowed_origin(self, origin: str) -> bool:
        decision = self._origin_decision.get()
        if decision is not None and decision[0] == origin:
            return decision[1]
        return super().is_allowed_origin(origin)
