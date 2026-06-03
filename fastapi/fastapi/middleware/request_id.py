import uuid
from starlette.types import ASGIApp, Receive, Scope, Send
from fastapi.logger import request_id_var

class RequestIDMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = None
        for k, v in scope.get("headers", []):
            if k.lower() == b"x-request-id":
                request_id = v.decode("latin1")
                break

        if not request_id:
            request_id = str(uuid.uuid4())

        if "state" not in scope:
            scope["state"] = {}
        scope["state"]["request_id"] = request_id

        # Set the contextvar value
        token = request_id_var.set(request_id)
        try:
            async def send_wrapper(message):
                if message["type"] == "http.response.start":
                    headers = list(message.get("headers", []))
                    has_request_id = False
                    for i, (k, v) in enumerate(headers):
                        if k.lower() == b"x-request-id":
                            has_request_id = True
                            break
                    if not has_request_id:
                        headers.append((b"x-request-id", request_id.encode("latin1")))
                    message["headers"] = headers
                await send(message)

            await self.app(scope, receive, send_wrapper)
        finally:
            request_id_var.reset(token)
