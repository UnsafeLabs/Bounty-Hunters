import logging
import uuid
from typing import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp

from fastapi.logger import logger


class RequestIDMiddleware(BaseHTTPMiddleware):
    """
    Middleware that attaches a unique request ID to each request.

    - If the client sends an ``X-Request-ID`` header, that value is used.
    - Otherwise a new UUID is generated.
    - The request ID is stored in ``request.state.request_id`` and
      echoed back in the ``X-Request-ID`` response header.
    - The default logger is configured to include the request ID in
      log records for the duration of the request.
    """

    def __init__(self, app: ASGIApp, *, header_name: str = "X-Request-ID") -> None:
        super().__init__(app)
        self.header_name = header_name

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        # Read or generate request ID
        request_id = request.headers.get(self.header_name) or str(uuid.uuid4())
        request.state.request_id = request_id

        # Add logging filter for this request
        _old_filters = list(logger.filters)
        logger.filters.append(_RequestIDFilter(request_id))

        try:
            response = await call_next(request)
        finally:
            # Restore original filters
            logger.filters = _old_filters

        response.headers[self.header_name] = request_id
        return response


class _RequestIDFilter(logging.Filter):
    """Temporary logging filter that adds request_id to every record."""

    def __init__(self, request_id: str) -> None:
        super().__init__()
        self.request_id = request_id

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = self.request_id
        return True
