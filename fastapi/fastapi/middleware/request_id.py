"""
Request ID middleware for log correlation.
Adds a unique request ID to each request for tracing across logs.
"""
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
import uuid
import contextvars

# Context variable for request-scoped request ID
request_id_ctx: contextvars.ContextVar[str] = contextvars.ContextVar(
    "request_id", default=""
)


class RequestIDMiddleware(BaseHTTPMiddleware):
    """
    Middleware that adds a unique request ID to each request.

    Features:
    - Generates UUID4 request ID if not provided
    - Reads existing request ID from configurable header
    - Adds request ID to response headers
    - Sets context variable for log correlation
    - Supports custom ID generation functions
    """

    def __init__(
        self,
        app,
        header_name: str = "X-Request-ID",
        generate_id: callable = None,
        echo_header: bool = True,
    ):
        super().__init__(app)
        self.header_name = header_name
        self.generate_id = generate_id or (lambda: str(uuid.uuid4()))
        self.echo_header = echo_header

    async def dispatch(self, request: Request, call_next) -> Response:
        # Get or generate request ID
        request_id = request.headers.get(self.header_name)
        if not request_id:
            request_id = self.generate_id()

        # Set in request state and context variable
        request.state.request_id = request_id
        token = request_id_ctx.set(request_id)

        try:
            response = await call_next(request)

            # Add request ID to response headers
            if self.echo_header:
                response.headers[self.header_name] = request_id

            return response
        finally:
            request_id_ctx.reset(token)


def get_request_id() -> str:
    """Get the current request ID from context."""
    return request_id_ctx.get("")
