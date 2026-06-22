from __future__ import annotations

from typing import Any, Callable, Coroutine, Optional, Union

from starlette.middleware.cors import CORSMiddleware as CORSMiddleware  # noqa
from starlette.middleware.cors import CORSMiddleware as StarletteCORSMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send

from fastapi import Request


class DynamicCORSMiddleware(StarletteCORSMiddleware):
    """CORS middleware that supports dynamic origin validation via callback."""

    def __init__(
        self,
        app: ASGIApp,
        allow_origin_func: Optional[
            Union[
                Callable[[str], bool],
                Callable[[str], Coroutine[Any, Any, bool]],
            ]
        ] = None,
        cors_max_age: int = 600,
        allow_origins: Optional[list[str]] = None,
        allow_origin_regex: Optional[str] = None,
        allow_methods: Optional[list[str]] = None,
        allow_headers: Optional[list[str]] = None,
        allow_credentials: bool = False,
        expose_headers: Optional[list[str]] = None,
        max_age: Optional[int] = None,
    ) -> None:
        super().__init__(
            app=app,
            allow_origins=allow_origins or [],
            allow_origin_regex=allow_origin_regex,
            allow_methods=allow_methods or ["GET"],
            allow_headers=allow_headers or [],
            allow_credentials=allow_credentials,
            expose_headers=expose_headers or [],
            max_age=max_age,
        )
        self.allow_origin_func = allow_origin_func
        self.cors_max_age = cors_max_age

    async def is_origin_allowed(self, origin: str) -> bool:
        """Check if an origin is allowed, using dynamic callback if provided."""
        if self.allow_origin_func is not None:
            result = self.allow_origin_func(origin)
            if hasattr(result, "__await__"):
                return await result
            return bool(result)
        return super().is_origin_allowed(origin)

    def preflight_response(self, request: Request) -> dict[str, str]:
        """Return preflight response headers with configurable max age."""
        headers = super().preflight_response(request)
        headers["Access-Control-Max-Age"] = str(self.cors_max_age)
        return headers

