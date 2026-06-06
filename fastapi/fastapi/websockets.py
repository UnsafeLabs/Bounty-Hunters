import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Any

from starlette.websockets import WebSocket as WebSocket  # noqa
from starlette.websockets import WebSocketDisconnect as WebSocketDisconnect  # noqa
from starlette.websockets import WebSocketState as WebSocketState  # noqa

DisconnectCallback = Callable[[int, float], None | Awaitable[None]]
PONG_MESSAGE = "__pong__"
PING_MESSAGE = "__ping__"


class WebSocketWithHeartbeat:
    def __init__(
        self,
        websocket: WebSocket,
        *,
        ping_interval: float = 30.0,
        pong_timeout: float = 10.0,
        on_disconnect: DisconnectCallback | None = None,
        close_code: int = 1001,
        ping_message: str = PING_MESSAGE,
        pong_message: str = PONG_MESSAGE,
    ) -> None:
        self.websocket = websocket
        self.ping_interval = ping_interval
        self.pong_timeout = pong_timeout
        self.on_disconnect = on_disconnect
        self.close_code = close_code
        self.ping_message = ping_message
        self.pong_message = pong_message
        self.message_count = 0
        self._started_at = time.monotonic()
        self._last_pong_at = self._started_at
        self._heartbeat_task: asyncio.Task[None] | None = None
        self._closed = False
        self._disconnect_notified = False

    @property
    def connection_duration(self) -> float:
        return time.monotonic() - self._started_at

    async def accept(self, *args: Any, **kwargs: Any) -> None:
        await self.websocket.accept(*args, **kwargs)
        self.start_heartbeat()

    def start_heartbeat(self) -> None:
        if self._heartbeat_task is None or self._heartbeat_task.done():
            self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        self._closed = True
        if (
            self._heartbeat_task is not None
            and self._heartbeat_task is not asyncio.current_task()
        ):
            self._heartbeat_task.cancel()
        kwargs: dict[str, Any] = {"code": code}
        if reason is not None:
            kwargs["reason"] = reason
        await self.websocket.close(**kwargs)
        await self._fire_disconnect(code)

    async def receive(self) -> dict[str, Any]:
        try:
            message = await self.websocket.receive()
        except WebSocketDisconnect as exc:
            await self._fire_disconnect(exc.code)
            raise
        return self._track_message(message)

    async def receive_text(self) -> str:
        try:
            text = await self.websocket.receive_text()
        except WebSocketDisconnect as exc:
            await self._fire_disconnect(exc.code)
            raise
        self.message_count += 1
        self._track_pong(text)
        return text

    async def receive_bytes(self) -> bytes:
        try:
            data = await self.websocket.receive_bytes()
        except WebSocketDisconnect as exc:
            await self._fire_disconnect(exc.code)
            raise
        self.message_count += 1
        return data

    async def receive_json(self, *args: Any, **kwargs: Any) -> Any:
        try:
            data = await self.websocket.receive_json(*args, **kwargs)
        except WebSocketDisconnect as exc:
            await self._fire_disconnect(exc.code)
            raise
        self.message_count += 1
        return data

    def record_pong(self) -> None:
        self._last_pong_at = time.monotonic()

    async def send_ping(self) -> None:
        await self.websocket.send_text(self.ping_message)

    async def _heartbeat_loop(self) -> None:
        try:
            while not self._closed:
                await asyncio.sleep(self.ping_interval)
                await self.send_ping()
                await asyncio.sleep(self.pong_timeout)
                if time.monotonic() - self._last_pong_at > self.ping_interval + self.pong_timeout:
                    await self.close(code=self.close_code)
                    return
        except asyncio.CancelledError:
            return

    def _track_message(self, message: dict[str, Any]) -> dict[str, Any]:
        self.message_count += 1
        if message.get("type") == "websocket.receive":
            self._track_pong(message.get("text"))
        return message

    def _track_pong(self, text: str | None) -> None:
        if text == self.pong_message:
            self.record_pong()

    async def _fire_disconnect(self, code: int) -> None:
        if self.on_disconnect is None or self._disconnect_notified:
            return
        self._disconnect_notified = True
        result = self.on_disconnect(code, self.connection_duration)
        if result is not None:
            await result

    def __getattr__(self, name: str) -> Any:
        return getattr(self.websocket, name)
