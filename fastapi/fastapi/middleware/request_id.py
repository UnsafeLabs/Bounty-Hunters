"""
Request ID middleware for log correlation.

Injects a unique request ID into every request/response cycle for
tracing and log correlation across the request lifecycle.
"""
from __future__ import annotations

import contextvars
import logging
import uuid
from typing import TYPE_CHECKING

from starlette.middleware.base import BaseHTTPMiddleware

if TYPE_CHECKING:
    from starlette.requests import Request
    from starlette.responses import Response

request_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "request_id", default=None
)


class RequestIDLogFilter(logging.Filter):
    """Inject the current request ID into log records."""

    def filter(self, record: logging.LogRecord) -> bool:
        rid = request_id_var.get()
        if rid:
            record.request_id = rid  # type: ignore[attr-defined]
        else:
            record.request_id = "-"  # type: ignore[attr-defined]
        return True


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Middleware that assigns and propagates a request ID.

    - Reads an incoming ``X-Request-ID`` header if present.
    - Generates a UUID4 when no ID is provided by the client.
    - Stores the ID in ``request.state.request_id`` and as a context variable
      so that log records emitted during the request automatically include it.
    - Echoes the ID back in the ``X-Request-ID`` response header.
    """

    async def dispatch(self, request: Request, call_next: callable) -> Response:  # type: ignore[override]
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        request.state.request_id = request_id
        token = request_id_var.set(request_id)
        try:
            response = await call_next(request)
        finally:
            request_id_var.reset(token)
        response.headers["X-Request-ID"] = request_id
        return response
