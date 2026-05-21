"""
FastAPI Request ID Middleware.

Generates or propagates a unique X-Request-ID for each HTTP request,
enabling log correlation across the full request lifecycle.
"""

import contextvars
import logging
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

# Context variable to hold the current request ID within a request scope.
# Accessible from anywhere in the same async task / thread via `request_id_ctx.get()`.
request_id_ctx: contextvars.ContextVar[str] = contextvars.ContextVar(
    "request_id", default="-"
)

HEADER_REQUEST_ID = "X-Request-ID"


class RequestIDLogFilter(logging.Filter):
    """Log filter that injects the current request ID into log records."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_ctx.get()
        return True


class RequestIDMiddleware(BaseHTTPMiddleware):
    """
    ASGI middleware that ensures every request carries a stable X-Request-ID.

    - If the client sends an ``X-Request-ID`` header, the middleware echoes it
      back and uses it for log correlation.
    - Otherwise a new UUIDv4 is generated.
    - The request ID is stored in ``request.state.request_id`` and set in the
      ``request_id_ctx`` context variable for logger integration.
    """

    async def dispatch(self, request: Request, call_next):
        req_id = request.headers.get(HEADER_REQUEST_ID)
        if not req_id:
            req_id = uuid.uuid4().hex

        request.state.request_id = req_id
        token = request_id_ctx.set(req_id)

        try:
            response: Response = await call_next(request)
        finally:
            request_id_ctx.reset(token)

        response.headers[HEADER_REQUEST_ID] = req_id
        return response