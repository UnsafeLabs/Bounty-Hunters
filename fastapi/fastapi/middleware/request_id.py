import uuid
from collections.abc import Callable

from fastapi.logger import request_id_context
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

REQUEST_ID_HEADER = "X-Request-ID"


class RequestIDMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        header_name: str = REQUEST_ID_HEADER,
        generator: Callable[[], str] | None = None,
    ) -> None:
        self.app = app
        self.header_name = header_name
        self._header_name_bytes = header_name.lower().encode("latin-1")
        self.generator = generator or (lambda: str(uuid.uuid4()))

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = self._get_request_id(scope)
        state = scope.setdefault("state", {})
        state["request_id"] = request_id
        token = request_id_context.set(request_id)

        async def send_with_request_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers[self.header_name] = request_id
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        finally:
            request_id_context.reset(token)

    def _get_request_id(self, scope: Scope) -> str:
        for key, value in scope.get("headers", []):
            if key.lower() == self._header_name_bytes:
                return value.decode("latin-1")
        return self.generator()
