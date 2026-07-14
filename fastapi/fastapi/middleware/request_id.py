import uuid
from contextvars import ContextVar

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Middleware that assigns a unique UUID to each request.

    Generates a UUID for each incoming request, stores it in request state,
    echoes it in the X-Request-ID response header, and makes it available
    via context variable for logger integration.

    If the client sends an X-Request-ID header, that value is reused.
    """

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        req_id = request.headers.get("X-Request-ID")
        if not req_id:
            req_id = str(uuid.uuid4())

        request.state.request_id = req_id
        request_id_var.set(req_id)

        response = await call_next(request)
        response.headers["X-Request-ID"] = req_id
        return response
