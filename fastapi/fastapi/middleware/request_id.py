import uuid

from fastapi.logger import request_id_context
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class RequestIDMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        header_name: str = "X-Request-ID",
        state_attribute: str = "request_id",
    ) -> None:
        self.app = app
        self.header_name = header_name
        self.state_attribute = state_attribute

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = self._get_request_id(scope)
        scope.setdefault("state", {})[self.state_attribute] = request_id
        token = request_id_context.set(request_id)

        async def send_with_request_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = message.setdefault("headers", [])
                headers.append((self.header_name.lower().encode(), request_id.encode()))
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        finally:
            request_id_context.reset(token)

    def _get_request_id(self, scope: Scope) -> str:
        header_name = self.header_name.lower().encode()
        for name, value in scope.get("headers", []):
            if name.lower() == header_name:
                return value.decode()
        return str(uuid.uuid4())
