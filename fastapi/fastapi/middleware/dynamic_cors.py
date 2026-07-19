from typing import Any, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


class DynamicCORSMiddleware(BaseHTTPMiddleware):
    """Dynamic CORS origin validation with callback support."""

    def __init__(
        self,
        app: Any,
        allow_origin_callback: Callable[[str], bool],
        allow_methods: list[str] | None = None,
        allow_headers: list[str] | None = None,
        allow_credentials: bool = True,
        max_age: int = 600,
    ) -> None:
        super().__init__(app)
        self.allow_origin_callback = allow_origin_callback
        self.allow_methods = allow_methods or ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
        self.allow_headers = allow_headers or ["*"]
        self.allow_credentials = allow_credentials
        self.max_age = max_age

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        origin = request.headers.get("Origin")

        if origin and self.allow_origin_callback(origin):
            if request.method == "OPTIONS":
                response = Response(status_code=204)
            else:
                response = await call_next(request)

            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Methods"] = ", ".join(self.allow_methods)
            response.headers["Access-Control-Allow-Headers"] = ", ".join(self.allow_headers)
            response.headers["Access-Control-Max-Age"] = str(self.max_age)
            if self.allow_credentials:
                response.headers["Access-Control-Allow-Credentials"] = "true"
            return response

        return await call_next(request)
