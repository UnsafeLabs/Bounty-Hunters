import asyncio
import json
import logging
from typing import Any, Callable

from starlette.types import ASGIApp, Receive, Scope, Send

logger = logging.getLogger("fastapi.websocket_heartbeat")


class WebSocketHeartbeatMiddleware:
    """WebSocket heartbeat with configurable ping interval and disconnect callback."""

    def __init__(
        self,
        app: ASGIApp,
        ping_interval: float = 30.0,
        ping_timeout: float = 10.0,
        on_disconnect: Callable[[str], Any] | None = None,
    ) -> None:
        self.app = app
        self.ping_interval = ping_interval
        self.ping_timeout = ping_timeout
        self.on_disconnect = on_disconnect

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "websocket":
            await self.app(scope, receive, send)
            return

        client_id = f"{scope.get('client', ('', 0))[0]}:{scope.get('client', ('', 0))[1]}"

        async def heartbeat() -> None:
            try:
                while True:
                    await asyncio.sleep(self.ping_interval)
                    ping_msg = json.dumps({"type": "ping"})
                    await send({"type": "websocket.send", "text": ping_msg})
            except asyncio.CancelledError:
                pass
            except Exception:
                pass

        heartbeat_task: asyncio.Task[None] | None = None

        async def wrapped_receive() -> dict[str, Any]:
            nonlocal heartbeat_task
            message = await receive()
            if message["type"] == "websocket.connect" and heartbeat_task is None:
                heartbeat_task = asyncio.create_task(heartbeat())
            elif message["type"] == "websocket.disconnect":
                if heartbeat_task:
                    heartbeat_task.cancel()
                if self.on_disconnect:
                    try:
                        result = self.on_disconnect(client_id)
                        if hasattr(result, "__await__"):
                            await result
                    except Exception as e:
                        logger.error("on_disconnect callback error: %s", e)
            return message

        try:
            await self.app(scope, wrapped_receive, send)
        finally:
            if heartbeat_task:
                heartbeat_task.cancel()
