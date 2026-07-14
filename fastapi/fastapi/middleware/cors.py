from collections.abc import Awaitable, Callable
from typing import Any

from starlette.middleware.cors import CORSMiddleware as CORSMiddleware  # noqa
from starlette.middleware.cors import CORSMiddleware as _CORSMiddleware
from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class DynamicCORSMiddleware:
    """CORS middleware with dynamic origin validation callback.

    Extends standard CORS behavior with a callback-based origin check
    that supports both sync and async functions for runtime origin decisions.
    """

    def __init__(
        self,
        app: ASGIApp,
        allow_origins: list[str] | None = None,
        allow_origin_func: Callable[[str], bool] | Callable[[str], Awaitable[bool]] | None = None,
        allow_methods: list[str] | None = None,
        allow_headers: list[str] | None = None,
        allow_credentials: bool = False,
        allow_origin_regex: str | None = None,
        expose_headers: list[str] | None = None,
        cors_max_age: int = 600,
    ) -> None:
        self.app = app
        self.allow_origins = allow_origins or ["*"]
        self.allow_origin_func = allow_origin_func
        self.allow_methods = allow_methods or ["GET"]
        self.allow_headers = allow_headers or []
        self.allow_credentials = allow_credentials
        self.allow_origin_regex = allow_origin_regex
        self.expose_headers = expose_headers or []
        self.cors_max_age = cors_max_age

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Extract origin from headers
        origin: str | None = None
        for header_name, header_value in scope.get("headers", []):
            if header_name == b"origin":
                origin = header_value.decode("latin-1")
                break

        # Determine effective allow_origins
        effective_origins = list(self.allow_origins)

        if origin is not None and self.allow_origin_func is not None:
            result = self.allow_origin_func(origin)
            if isinstance(result, Awaitable):
                is_allowed = await result
            else:
                is_allowed = result
            if is_allowed and origin not in effective_origins and "*" not in effective_origins:
                effective_origins.append(origin)

        # Delegate to Starlette CORSMiddleware with computed origins
        middleware = _CORSMiddleware(
            app=self.app,
            allow_origins=effective_origins,
            allow_methods=self.allow_methods,
            allow_headers=self.allow_headers,
            allow_credentials=self.allow_credentials,
            allow_origin_regex=self.allow_origin_regex,
            expose_headers=self.expose_headers,
            max_age=self.cors_max_age,
        )
        await middleware(scope, receive, send)
