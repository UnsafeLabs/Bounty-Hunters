from typing import Any, Awaitable, Callable, Optional, Sequence, Union

from starlette.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send


class DynamicCORSMiddleware(CORSMiddleware):
    def __init__(
        self,
        app: ASGIApp,
        allow_origins: Sequence[str] = (),
        allow_methods: Sequence[str] = ("GET",),
        allow_headers: Sequence[str] = (),
        allow_credentials: bool = False,
        allow_origin_regex: Optional[str] = None,
        expose_headers: Sequence[str] = (),
        max_age: int = 600,
        allow_origin_func: Optional[
            Callable[[str], Union[bool, Awaitable[bool]]]
        ] = None,
        cors_max_age: Optional[int] = None,
    ) -> None:
        # If cors_max_age is provided, it overrides max_age
        effective_max_age = cors_max_age if cors_max_age is not None else max_age
        
        super().__init__(
            app=app,
            allow_origins=allow_origins,
            allow_methods=allow_methods,
            allow_headers=allow_headers,
            allow_credentials=allow_credentials,
            allow_origin_regex=allow_origin_regex,
            expose_headers=expose_headers,
            max_age=effective_max_age,
        )
        self.allow_origin_func = allow_origin_func

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":  # pragma: no cover
            await self.app(scope, receive, send)
            return

        method = scope["method"]
        headers = dict(scope["headers"])
        origin = headers.get(b"origin")

        if origin is not None:
            origin_str = origin.decode("ascii")
            
            # If we have a dynamic check function, use it
            if self.allow_origin_func is not None:
                import inspect
                
                if inspect.iscoroutinefunction(self.allow_origin_func):
                    is_allowed = await self.allow_origin_func(origin_str)
                else:
                    is_allowed = self.allow_origin_func(origin_str)  # type: ignore
                
                if is_allowed:
                    # Temporarily add to allow_origins so the parent class logic handles the headers
                    # Note: This is safe because CORSMiddleware checks against this list in simple responses
                    # and preflights.
                    original_origins = self.allow_origins
                    self.allow_origins = list(original_origins) + [origin_str]
                    try:
                        await super().__call__(scope, receive, send)
                    finally:
                        self.allow_origins = original_origins
                    return

        # Fallback to static list if func not provided or origin not dynamically allowed
        await super().__call__(scope, receive, send)
