import asyncio
import contextlib
import inspect
import time
from collections.abc import Callable
from typing import Any

from starlette.websockets import WebSocket as WebSocket  # noqa
from starlette.websockets import WebSocketDisconnect as WebSocketDisconnect  # noqa
from starlette.websockets import WebSocketState as WebSocketState  # noqa


class WebSocketWithHeartbeat:
    def __init__(
        self,
        websocket: WebSocket,
        *,
        ping_interval: float = 30.0,
        pong_timeout: float = 10.0,
        on_disconnect: Callable[[int, float], Any] | None = None,
        ping_message: str = "ping",
        pong_message: str = "pong",
    ):
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
        self._started_at = time.monotonic()
        self._message_count = 0
        self._closed = False
        self._disconnect_notified = False
        self._heartbeat_task: asyncio.Task[None] | None = None
        self._pending_messages: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

    @property
    def connection_duration(self) -> float:
        return time.monotonic() - self._started_at

    @property
    def message_count(self) -> int:
        return self._message_count

    def __getattr__(self, name: str) -> Any:
        return getattr(self.websocket, name)

    async def accept(
        self, *args: Any, start_heartbeat: bool = True, **kwargs: Any
    ) -> None:
        await self.websocket.accept(*args, **kwargs)
        if start_heartbeat:
            self.start_heartbeat()

    def start_heartbeat(self) -> asyncio.Task[None]:
        if self._heartbeat_task is None or self._heartbeat_task.done():
            self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())
        return self._heartbeat_task

    async def stop_heartbeat(self) -> None:
        task = self._heartbeat_task
        if task is None or task.done():
            return
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        if self._closed:
            return
        self._closed = True
        await self.websocket.close(code=code, reason=reason)
        await self._notify_disconnect(code)
        task = self._heartbeat_task
        if task is not None and task is not asyncio.current_task():
            await self.stop_heartbeat()

    async def receive(self) -> dict[str, Any]:
        if not self._pending_messages.empty():
            message = self._pending_messages.get_nowait()
        else:
            message = await self.websocket.receive()
        await self._handle_received_message(message)
        return message

    async def receive_text(self) -> str:
        message = await self.receive()
        self._raise_on_disconnect(message)
        text = message.get("text")
        if text is None:
            data = message.get("bytes", b"")
            return data.decode()
        return text

    async def receive_bytes(self) -> bytes:
        message = await self.receive()
        self._raise_on_disconnect(message)
        data = message.get("bytes")
        if data is None:
            return message.get("text", "").encode()
        return data

    async def _heartbeat_loop(self) -> None:
        while not self._closed:
            await asyncio.sleep(self.ping_interval)
            if self._closed:
                return
            await self.websocket.send_text(self.ping_message)
            if not await self._wait_for_pong():
                await self.close(code=1001)
                return

    async def _wait_for_pong(self) -> bool:
        deadline = asyncio.get_running_loop().time() + self.pong_timeout
        while not self._closed:
            timeout = deadline - asyncio.get_running_loop().time()
            if timeout <= 0:
                return False
            try:
                message = await asyncio.wait_for(
                    self.websocket.receive(), timeout=timeout
                )
            except TimeoutError:
                return False
            if message.get("type") == "websocket.disconnect":
                code = message.get("code", 1001)
                self._closed = True
                await self._notify_disconnect(code)
                return True
            if self._is_pong(message):
                return True
            await self._pending_messages.put(message)
        return True

    def _is_pong(self, message: dict[str, Any]) -> bool:
        return message.get("type") == "websocket.receive" and (
            message.get("text") == self.pong_message
            or message.get("bytes") == self.pong_message.encode()
        )

    async def _handle_received_message(self, message: dict[str, Any]) -> None:
        if message.get("type") == "websocket.disconnect":
            self._closed = True
            await self._notify_disconnect(message.get("code", 1001))
            return
        if message.get("type") == "websocket.receive":
            self._message_count += 1

    async def _notify_disconnect(self, code: int) -> None:
        if self._disconnect_notified or self.on_disconnect is None:
            return
        self._disconnect_notified = True
        result = self.on_disconnect(code, self.connection_duration)
        if inspect.isawaitable(result):
            await result

    @staticmethod
    def _raise_on_disconnect(message: dict[str, Any]) -> None:
        if message.get("type") == "websocket.disconnect":
            raise WebSocketDisconnect(
                code=message.get("code", 1001),
                reason=message.get("reason"),
            )
