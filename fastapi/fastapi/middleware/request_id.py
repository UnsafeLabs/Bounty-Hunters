import uuid
from contextvars import ContextVar

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

request_id_var: ContextVar[str] = ContextVar("request_id")


class RequestIDMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        req_id = None
        headers = MutableHeaders(scope=scope)
        for name, value in scope.get("headers", []):
            if name.decode("latin-1").lower() == "x-request-id":
                req_id = value.decode("latin-1")
                break

        if not req_id:
            req_id = uuid.uuid4().hex[:12]

        request_id_var.set(req_id)
        headers.append("X-Request-ID", req_id)

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                msg_headers = MutableHeaders(raw=message.get("headers", []))
                msg_headers.append("X-Request-ID", req_id)
            await send(message)

        await self.app(scope, receive, send_wrapper)
