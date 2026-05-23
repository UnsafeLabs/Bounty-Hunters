"""
Request ID middleware for FastAPI - log correlation across request lifecycle.

Generates a UUID request ID for each incoming request, stores it in
request.state, echoes client-provided X-Request-ID headers, and plumbs
the ID into log records so all entries during a request carry it.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp

__all__ = ["RequestIDMiddleware", "request_id_context"]

request_id_context: dict[str, str | None] = {"id": None}


class RequestIDFilter(logging.Filter):
    """Log filter that injects the current request ID into every record."""

    def filter(self, record: logging.LogRecord) -> bool:
        rid = request_id_context.get("id")
        record.request_id = rid or "-"
        return True


def _install_filter() -> None:
    logger = logging.getLogger("fastapi")
    for f in logger.filters:
        if isinstance(f, RequestIDFilter):
            return
    logger.addFilter(RequestIDFilter())


_install_filter()


class RequestIDMiddleware(BaseHTTPMiddleware):
    """ASGI middleware that attaches a unique request ID to every request."""

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        client_id = request.headers.get("X-Request-ID")
        rid: str = client_id or uuid.uuid4().hex

        request_id_context["id"] = rid
        request.state.request_id = rid

        try:
            response: Response = await call_next(request)
        finally:
            request_id_context["id"] = None

        response.headers["X-Request-ID"] = rid
        return response
