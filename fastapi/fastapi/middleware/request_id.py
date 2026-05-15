import logging
from contextvars import ContextVar
from uuid import uuid4

from starlette.types import ASGIApp, Message, Receive, Scope, Send

REQUEST_ID_HEADER = "x-request-id"
request_id_context: ContextVar[str | None] = ContextVar(
    "fastapi_request_id", default=None
)


class RequestIDFilter(logging.Filter):
    """Inject the current request ID into log records."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_context.get()
        return True


class RequestIDMiddleware:
    """Attach an X-Request-ID header and expose it during request handling."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers") or [])
        request_id = headers.get(REQUEST_ID_HEADER.encode("latin-1"))
        if request_id is None:
            request_id_value = str(uuid4())
        else:
            request_id_value = request_id.decode("latin-1")

        scope.setdefault("state", {})["request_id"] = request_id_value
        token = request_id_context.set(request_id_value)

        async def send_with_request_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                raw_headers = list(message.get("headers", []))
                raw_headers.append(
                    (
                        REQUEST_ID_HEADER.encode("latin-1"),
                        request_id_value.encode("latin-1"),
                    )
                )
                message["headers"] = raw_headers
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        finally:
            request_id_context.reset(token)
