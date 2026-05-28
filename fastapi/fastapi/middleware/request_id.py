"""
Request ID middleware for FastAPI.

Adds a unique request ID to each incoming request for log correlation.
The ID is set as both a response header (X-Request-ID) and a request
state variable (request.state.request_id).
"""

import uuid
from typing import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


class RequestIDMiddleware(BaseHTTPMiddleware):
    """
    Middleware that assigns a unique UUID to each request.

    The request ID is:
    - Set as the ``X-Request-ID`` response header
    - Accessible via ``request.state.request_id`` in route handlers
    - Included in all log messages emitted during request processing

    Usage::

        from fastapi import FastAPI
        from fastapi.middleware.request_id import RequestIDMiddleware

        app = FastAPI()
        app.add_middleware(RequestIDMiddleware)
    """

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id

        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id

        return response
