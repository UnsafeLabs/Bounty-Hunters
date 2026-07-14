import contextvars
import uuid

from starlette.middleware.base import (
    BaseHTTPMiddleware,
    RequestResponseEndpoint,
)
from starlette.requests import Request
from starlette.responses import Response


# Context variable for request ID, shared with logger
request_id_ctx: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "request_id", default=None
)


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Adds a unique X-Request-ID header to each request/response cycle.

    If the client sends an X-Request-ID header, that value is preserved.
    Otherwise, a new UUIDv4 is generated.
    """

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        incoming = request.headers.get("X-Request-ID")
        rid = incoming if incoming else str(uuid.uuid4())

        request_id_ctx.set(rid)
        request.scope.setdefault("state", {})
        request.state.request_id = rid  # type: ignore[attr-defined]

        response = await call_next(request)

        response.headers["X-Request-ID"] = rid
        return response
