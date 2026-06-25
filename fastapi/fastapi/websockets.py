import asyncio
import inspect
import time
from collections.abc import Awaitable, Callable
from typing import Any

from starlette.websockets import WebSocket as WebSocket
from starlette.websockets import WebSocketDisconnect as WebSocketDisconnect  # noqa
from starlette.websockets import WebSocketState as WebSocketState  # noqa

HeartbeatDisconnectCallback = Callable[[int, float], Any]
HeartbeatPingSender = Callable[["WebSocketWithHeartbeat"], Awaitable[None]]


class WebSocketWithHeartbeat:
    def __init__(
        self,
        websocket: WebSocket,
        *,
        ping_interval: float = 30.0,
        pong_timeout: float = 10.0,
        on_disconnect: HeartbeatDisconnectCallback | None = None,
        ping_sender: HeartbeatPingSender | None = None,
    ) -> None:
        self.websocket = websocket
        self.ping_interval = ping_interval
        self.pong_timeout = pong_timeout
        self.on_disconnect = on_disconnect
        self.ping_sender = ping_sender or self._send_ping
        self.message_count = 0
        self._started_at = time.monotonic()
        self._last_pong_at = self._started_at
        self._heartbeat_task: asyncio.Task[None] | None = None
        self._disconnect_reported = False

    @property
    def connection_duration(self) -> float:
        return time.monotonic() - self._started_at

    async def __aenter__(self) -> "WebSocketWithHeartbeat":
        self.start_heartbeat()
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        await self.stop_heartbeat()

    def __getattr__(self, name: str) -> Any:
        return getattr(self.websocket, name)

    def start_heartbeat(self) -> None:
        if self._heartbeat_task is None or self._heartbeat_task.done():
            self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

    async def stop_heartbeat(self) -> None:
        if self._heartbeat_task is None:
            return
        self._heartbeat_task.cancel()
        try:
            await self._heartbeat_task
        except asyncio.CancelledError:
            pass
        finally:
            self._heartbeat_task = None

    async def receive(self) -> dict[str, Any]:
        try:
            message = await self.websocket.receive()
        except WebSocketDisconnect as exc:
            await self._report_disconnect(exc.code)
            raise

        if message["type"] == "websocket.disconnect":
            await self._report_disconnect(message["code"])
        elif message["type"] == "websocket.receive":
            self.message_count += 1
            self._last_pong_at = time.monotonic()
        return message

    async def receive_text(self) -> str:
        message = await self.receive()
        if message["type"] == "websocket.disconnect":
            raise WebSocketDisconnect(message["code"], message.get("reason"))
        return str(message["text"])

    async def receive_bytes(self) -> bytes:
        message = await self.receive()
        if message["type"] == "websocket.disconnect":
            raise WebSocketDisconnect(message["code"], message.get("reason"))
        return bytes(message["bytes"])

    async def receive_json(self, mode: str = "text") -> Any:
        import json

        if mode not in {"text", "binary"}:
            raise RuntimeError('The "mode" argument should be "text" or "binary".')
        message = await self.receive()
        if message["type"] == "websocket.disconnect":
            raise WebSocketDisconnect(message["code"], message.get("reason"))
        if mode == "text":
            return json.loads(message["text"])
        return json.loads(message["bytes"].decode("utf-8"))

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        await self.websocket.close(code=code, reason=reason)
        await self._report_disconnect(code)

    async def _heartbeat_loop(self) -> None:
        while True:
            await asyncio.sleep(self.ping_interval)
            ping_started_at = time.monotonic()
            await self.ping_sender(self)
            await asyncio.sleep(self.pong_timeout)
            if self._last_pong_at < ping_started_at:
                await self.websocket.close(code=1001)
                await self._report_disconnect(1001)
                return

    async def _send_ping(self, websocket: "WebSocketWithHeartbeat") -> None:
        await websocket.websocket.send_bytes(b"")

    async def _report_disconnect(self, code: int) -> None:
        if self._disconnect_reported:
            return
        self._disconnect_reported = True
        if self.on_disconnect is None:
            return
        result = self.on_disconnect(code, self.connection_duration)
        if inspect.isawaitable(result):
            await result
