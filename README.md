from typing import Any, Awaitable, Callable, List, Optional, Union
from starlette.middleware.cors import CORSMiddleware as CORSMiddleware  # noqa
from starlette.types import ASGIApp, Receive, Scope, Send
import anyio

class DynamicCORSMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        allow_origin_func: Optional[Callable[[str], Union[bool, Awaitable[bool]]]] = None,
        allow_origins: List[str] = None,
        cors_max_age: int = 600,
        **kwargs: Any,
    ) -> None:
        self.app = app
        self.allow_origin_func = allow_origin_func
        self.allow_origins = allow_origins or []
        self.cors_max_age = cors_max_age
        self.kwargs = kwargs

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" and scope["type"] != "websocket":
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        origin = headers.get(b"origin", b"").decode("utf-8")

        is_allowed = False
        if self.allow_origin_func:
            result = self.allow_origin_func(origin)
            if anyio.to_thread.is_current_thread_worker_thread():
                is_allowed = await result if hasattr(result, "__await__") else result
            else:
                is_allowed = await result if hasattr(result, "__await__") else result
        elif origin in self.allow_origins or "*" in self.allow_origins:
            is_allowed = True

        if is_allowed:
            scope.setdefault("headers", []).append((b"access-control-max-age", str(self.cors_max_age).encode("utf-8")))
            
        await self.app(scope, receive, send)