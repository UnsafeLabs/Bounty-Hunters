from __future__ import annotations

import logging
import uuid
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from starlette.requests import Request
    from starlette.responses import Response
    from starlette.types import ASGIApp, Receive, Scope, Send


class RequestIDMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = None
        headers = dict(scope.get("headers", []))

        # Check for client-provided X-Request-ID
        for name, value in headers.items():
            if isinstance(name, bytes) and isinstance(value, bytes):
                if name.lower() == b"x-request-id":
                    request_id = value.decode("ascii", errors="replace").strip()
                    break

        if not request_id:
            request_id = str(uuid.uuid4())

        # Store request ID in scope for downstream use
        scope["request_id"] = request_id

        # Create a logger adapter that includes the request ID
        logger = logging.getLogger("fastapi.request")
        logger_adapter = logging.LoggerAdapter(
            logger,
            {"request_id": request_id},
        )

        # Override send to add X-Request-ID header
        async def send_with_id(message: dict) -> None:
            if message["type"] == "http.response.start":
                raw_headers = message.get("headers", [])
                raw_headers.append(
                    (b"x-request-id", request_id.encode("ascii"))
                )
                message["headers"] = raw_headers
            await send(message)

        logger_adapter.info(
            "Request started: %s %s",
            scope.get("method", ""),
            scope.get("path", ""),
        )

        try:
            await self.app(scope, receive, send_with_id)
        except Exception as exc:
            logger_adapter.error(
                "Request failed: %s %s - %s",
                scope.get("method", ""),
                scope.get("path", ""),
                exc,
            )
            raise
        else:
            logger_adapter.info(
                "Request completed: %s %s",
                scope.get("method", ""),
                scope.get("path", ""),
            )
