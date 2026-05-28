from __future__ import annotations

import uuid

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class RequestIDMiddleware:
    """ASGI middleware that assigns a unique request ID to each HTTP request.

    * Generates a UUID4 request ID for every incoming request.
    * If the client sends an ``X-Request-ID`` header, that value is preserved
      and echoed back instead.
    * Stores the request ID in ``request.state.request_id`` so that
      application code (including log formatters) can access it.
    * Adds the ``X-Request-ID`` response header.

    ## Usage

    ```python
    from fastapi import FastAPI
    from fastapi.middleware.request_id import RequestIDMiddleware

    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)
    ```
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Extract client-provided request ID or generate a new one.
        headers = dict(scope.get("headers", []))
        client_request_id = headers.get(b"x-request-id")
        if client_request_id:
            request_id = client_request_id.decode("latin-1")
        else:
            request_id = str(uuid.uuid4())

        # Store on request.state so app code can access it.
        scope.setdefault("state", {})
        scope["state"]["request_id"] = request_id

        async def send_with_request_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers.append("X-Request-ID", request_id)
            await send(message)

        await self.app(scope, receive, send_with_request_id)
