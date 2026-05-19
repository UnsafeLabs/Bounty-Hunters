"""
Request ID middleware for FastAPI.

Adds a unique request ID to each incoming request and includes it
in the X-Request-ID response header. If the client provides an
X-Request-ID header, that value is used instead.
"""

from __future__ import annotations

import uuid

from fastapi.logger import _request_id_var
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class RequestIDMiddleware:
    """Middleware that assigns a unique request ID to each request."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Respect client-provided request ID, otherwise generate UUID4
        headers = {k.decode(): v.decode() for k, v in scope.get("headers", [])}
        client_request_id = headers.get("x-request-id")
        request_id = client_request_id or str(uuid.uuid4())

        # Set request ID in context variable for logger integration
        token = _request_id_var.set(request_id)

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers_list = list(message.get("headers", []))  # type: ignore[arg-type]
                # Remove any existing x-request-id header
                headers_list = [
                    (k, v) for k, v in headers_list
                    if k.lower() != b"x-request-id"
                ]
                headers_list.append((b"x-request-id", request_id.encode()))
                message["headers"] = headers_list  # type: ignore[index]
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            _request_id_var.reset(token)
