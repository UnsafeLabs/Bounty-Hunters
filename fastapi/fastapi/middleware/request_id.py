from contextvars import ContextVar
from uuid import uuid4

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

REQUEST_ID_HEADER = "X-Request-ID"

_request_id_context_var: ContextVar[str | None] = ContextVar(
    "fastapi_request_id", default=None
)


def get_request_id() -> str | None:
    return _request_id_context_var.get()


class RequestIDMiddleware:
    def __init__(self, app: ASGIApp, header_name: str = REQUEST_ID_HEADER) -> None:
        self.app = app
        self.header_name = header_name

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_headers = Headers(scope=scope)
        request_id = request_headers.get(self.header_name) or str(uuid4())
        scope.setdefault("state", {})["request_id"] = request_id
        token = _request_id_context_var.set(request_id)

        async def send_with_request_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                response_headers = MutableHeaders(scope=message)
                response_headers[self.header_name] = request_id
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        finally:
            _request_id_context_var.reset(token)
