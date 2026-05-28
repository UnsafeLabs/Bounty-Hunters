from __future__ import annotations

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class DeprecatedKeyWarningMiddleware:
    """ASGI middleware that adds a ``Warning`` header for deprecated API keys.

    Works in conjunction with :class:`~fastapi.security.api_key.APIKeyWithRateLimit`.
    When the dependency detects a deprecated key it stores the flag on
    ``request.state.api_key_deprecated``.  This middleware intercepts the
    response and injects the ``Warning`` header.

    ## Usage

    ```python
    from fastapi import FastAPI
    from fastapi.security.api_key import DeprecatedKeyWarningMiddleware

    app = FastAPI()
    app.add_middleware(DeprecatedKeyWarningMiddleware)
    ```
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # The dependency sets the flag on request.state AFTER the middleware
        # starts processing, so we must check it in the send callback
        # (which runs after the endpoint has executed).
        async def send_with_warning(message: Message) -> None:
            if message["type"] == "http.response.start":
                # Check the state now — the endpoint has run by this point.
                state = scope.get("state", {})
                if state.get("api_key_deprecated", False):
                    headers = MutableHeaders(scope=message)
                    headers.append(
                        "Warning",
                        '299 - "API key is deprecated and will be deactivated soon. '
                        'Please rotate to a new key."',
                    )
            await send(message)

        await self.app(scope, receive, send_with_warning)
