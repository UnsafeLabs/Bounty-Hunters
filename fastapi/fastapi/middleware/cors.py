from typing import Awaitable, Callable

from starlette.middleware.cors import CORSMiddleware as CORSMiddleware  # noqa
from starlette.datastructures import Headers
from starlette.requests import HTTPConnection
from starlette.responses import Response
from starlette.types import ASGIApp, Receive, Scope, Send


class DynamicCORSMiddleware:
    """
    Dynamic CORS middleware that accepts a callback for origin validation.

    Extends the standard CORS pattern by allowing a callable to dynamically
    determine whether an origin is allowed on a per-request basis. Supports
    both sync and async callbacks.

    ## Usage

    ```python
    from fastapi import FastAPI
    from fastapi.middleware.cors import DynamicCORSMiddleware

    app = FastAPI()

    def validate_origin(origin: str) -> bool:
        return origin.endswith(".example.com") or origin == "https://trusted.com"

    app.add_middleware(
        DynamicCORSMiddleware,
        allow_origin_func=validate_origin,
        cors_max_age=600,
    )
    ```
    """

    def __init__(
        self,
        app: ASGIApp,
        allow_origin_func: Callable[[str], bool | Awaitable[bool]] | None = None,
        cors_max_age: int | None = None,
    ) -> None:
        self.app = app
        self.allow_origin_func = allow_origin_func
        self.cors_max_age = cors_max_age

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        origin = None
        for name, value in scope.get("headers", []):
            if name == b"origin":
                origin = value.decode()
                break

        if origin and self.allow_origin_func:
            result = self.allow_origin_func(origin)
            if isinstance(result, Awaitable):
                allowed = await result
            else:
                allowed = result

            if not allowed:
                response = Response(status_code=403, content="Origin not allowed")
                await response(scope, receive, send)
                return

        await self.app(scope, receive, send)
