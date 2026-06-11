import asyncio
import inspect
import time
from collections.abc import Awaitable, Callable
from typing import Any

from starlette.websockets import WebSocket as StarletteWebSocket
from starlette.websockets import WebSocketDisconnect as WebSocketDisconnect  # noqa
from starlette.websockets import WebSocketState as WebSocketState  # noqa

WebSocket = StarletteWebSocket

DisconnectCallback = Callable[[int, float], Any | Awaitable[Any]]


class WebSocketWithHeartbeat:
    """
    Wrap a WebSocket with opt-in heartbeat messages and connection metrics.

    ASGI does not expose protocol-level ping/pong control frames to applications,
    so this helper sends application-level heartbeat messages and treats the
    configured pong message as liveness confirmation.
    """

    def __init__(
        self,
        websocket: WebSocket,
        *,
        ping_interval: float = 30.0,
        pong_timeout: float = 10.0,
        on_disconnect: DisconnectCallback | None = None,
        ping_message: Any = "__fastapi_ping__",
        pong_message: Any = "__fastapi_pong__",
    ) -> None:
        if ping_interval <= 0:
            raise ValueError("ping_interval must be greater than 0")
        if pong_timeout <= 0:
            raise ValueError("pong_timeout must be greater than 0")

        self.websocket = websocket
        self.ping_interval = ping_interval
        self.pong_timeout = pong_timeout
        self.on_disconnect = on_disconnect
        self.ping_message = ping_message
        self.pong_message = pong_message
        self.started_at = time.monotonic()
        self._message_count = 0
        self._pong_event = asyncio.Event()
        self._heartbeat_task: asyncio.Task[None] | None = None
        self._disconnect_notified = False
        self._closed = False

    def __getattr__(self, name: str) -> Any:
        return getattr(self.websocket, name)

    @property
    def connection_duration(self) -> float:
        return time.monotonic() - self.started_at

    @property
    def message_count(self) -> int:
        return self._message_count

    async def accept(self, *args: Any, **kwargs: Any) -> None:
        await self.websocket.accept(*args, **kwargs)
        self.start_heartbeat()

    def start_heartbeat(self) -> None:
        if self._heartbeat_task is None or self._heartbeat_task.done():
            self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

    async def stop_heartbeat(self) -> None:
        task = self._heartbeat_task
        if task is None or task.done() or task is asyncio.current_task():
            return
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    async def record_pong(self) -> None:
        self._pong_event.set()

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        self._closed = True
        await self.stop_heartbeat()
        if reason is None:
            await self.websocket.close(code=code)
        else:
            await self.websocket.close(code=code, reason=reason)
        await self._notify_disconnect(code)

    async def receive_text(self) -> str:
        while True:
            try:
                message = await self.websocket.receive_text()
            except WebSocketDisconnect as exc:
                await self._handle_disconnect(exc.code)
                raise
            if self._is_pong(message):
                await self.record_pong()
                continue
            self._record_message()
            return message

    async def receive_bytes(self) -> bytes:
        while True:
            try:
                message = await self.websocket.receive_bytes()
            except WebSocketDisconnect as exc:
                await self._handle_disconnect(exc.code)
                raise
            if self._is_pong(message):
                await self.record_pong()
                continue
            self._record_message()
            return message

    async def receive_json(self, *args: Any, **kwargs: Any) -> Any:
        while True:
            try:
                message = await self.websocket.receive_json(*args, **kwargs)
            except WebSocketDisconnect as exc:
                await self._handle_disconnect(exc.code)
                raise
            if self._is_pong(message):
                await self.record_pong()
                continue
            self._record_message()
            return message

    async def send_ping(self) -> None:
        if isinstance(self.ping_message, bytes):
            await self.websocket.send_bytes(self.ping_message)
        elif isinstance(self.ping_message, str):
            await self.websocket.send_text(self.ping_message)
        else:
            await self.websocket.send_json(self.ping_message)

    def _record_message(self) -> None:
        self._message_count += 1

    def _is_pong(self, message: Any) -> bool:
        return message == self.pong_message

    async def _heartbeat_loop(self) -> None:
        while not self._closed:
            await asyncio.sleep(self.ping_interval)
            if self._closed:
                return
            self._pong_event.clear()
            try:
                await self.send_ping()
                await asyncio.wait_for(
                    self._pong_event.wait(), timeout=self.pong_timeout
                )
            except asyncio.TimeoutError:
                await self._close_for_timeout()
                return
            except WebSocketDisconnect as exc:
                await self._handle_disconnect(exc.code)
                return

    async def _close_for_timeout(self) -> None:
        self._closed = True
        await self.websocket.close(code=1001)
        await self._notify_disconnect(1001)

    async def _handle_disconnect(self, code: int) -> None:
        self._closed = True
        await self.stop_heartbeat()
        await self._notify_disconnect(code)

    async def _notify_disconnect(self, code: int) -> None:
        if self._disconnect_notified:
            return
        self._disconnect_notified = True
        if self.on_disconnect is None:
            return
        result = self.on_disconnect(code, self.connection_duration)
        if inspect.isawaitable(result):
            await result
