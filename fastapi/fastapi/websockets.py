import asyncio
import inspect
import json
import time
from collections.abc import Awaitable, Callable
from contextlib import suppress
from typing import Any, cast

from starlette.types import Message
from starlette.websockets import WebSocket as WebSocket  # noqa
from starlette.websockets import WebSocketDisconnect as WebSocketDisconnect  # noqa
from starlette.websockets import WebSocketState as WebSocketState  # noqa

DisconnectCallback = Callable[[int, float], Awaitable[Any] | Any]


class WebSocketWithHeartbeat:
    def __init__(
        self,
        websocket: WebSocket,
        *,
        ping_interval: float = 30.0,
        pong_timeout: float = 10.0,
        on_disconnect: DisconnectCallback | None = None,
        ping_payload: bytes = b"ping",
        pong_payload: bytes = b"pong",
    ) -> None:
        self.websocket = websocket
        self.ping_interval = ping_interval
        self.pong_timeout = pong_timeout
        self.on_disconnect = on_disconnect
        self.ping_payload = ping_payload
        self.pong_payload = pong_payload
        self._started_at = time.monotonic()
        self._last_pong_at = self._started_at
        self._message_count = 0
        self._closed = False
        self._disconnect_notified = False
        self._heartbeat_task: asyncio.Task[None] | None = None

    @property
    def connection_duration(self) -> float:
        return time.monotonic() - self._started_at

    @property
    def message_count(self) -> int:
        return self._message_count

    def __getattr__(self, name: str) -> Any:
        return getattr(self.websocket, name)

    async def accept(self, *args: Any, **kwargs: Any) -> None:
        await self.websocket.accept(*args, **kwargs)
        self.start_heartbeat()

    def start_heartbeat(self) -> None:
        if self._heartbeat_task is None or self._heartbeat_task.done():
            self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

    async def stop_heartbeat(self) -> None:
        task = self._heartbeat_task
        if task is None or task.done():
            return
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task

    def record_pong(self) -> None:
        self._last_pong_at = time.monotonic()

    async def send_ping(self) -> None:
        await self.websocket.send_bytes(self.ping_payload)

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        if self._closed:
            return

        self._closed = True
        await self.websocket.close(code=code, reason=reason)
        if (
            self._heartbeat_task is not None
            and self._heartbeat_task is not asyncio.current_task()
        ):
            await self.stop_heartbeat()
        await self._notify_disconnect(code)

    async def receive(self) -> Message:
        while True:
            message = await self.websocket.receive()
            message_type = message.get("type")
            if message_type == "websocket.disconnect":
                self._closed = True
                await self.stop_heartbeat()
                await self._notify_disconnect(int(message.get("code", 1000)))
                return message

            if self._is_pong_message(message):
                self.record_pong()
                continue

            if message_type == "websocket.receive":
                self._message_count += 1

            return message

    async def receive_text(self) -> str:
        if self.websocket.application_state != WebSocketState.CONNECTED:
            raise RuntimeError(
                'WebSocket is not connected. Need to call "accept" first.'
            )
        message = await self.receive()
        self.websocket._raise_on_disconnect(message)
        return cast(str, message["text"])

    async def receive_bytes(self) -> bytes:
        if self.websocket.application_state != WebSocketState.CONNECTED:
            raise RuntimeError(
                'WebSocket is not connected. Need to call "accept" first.'
            )
        message = await self.receive()
        self.websocket._raise_on_disconnect(message)
        return cast(bytes, message["bytes"])

    async def receive_json(self, mode: str = "text") -> Any:
        if mode not in {"text", "binary"}:
            raise RuntimeError('The "mode" argument should be "text" or "binary".')
        if self.websocket.application_state != WebSocketState.CONNECTED:
            raise RuntimeError(
                'WebSocket is not connected. Need to call "accept" first.'
            )
        message = await self.receive()
        self.websocket._raise_on_disconnect(message)

        if mode == "text":
            text = message["text"]
        else:
            text = message["bytes"].decode("utf-8")
        return json.loads(text)

    async def _heartbeat_loop(self) -> None:
        try:
            while not self._closed:
                await asyncio.sleep(self.ping_interval)
                if self._closed:
                    return
                ping_sent_at = time.monotonic()
                await self.send_ping()
                await asyncio.sleep(self.pong_timeout)
                if not self._closed and self._last_pong_at < ping_sent_at:
                    await self.close(code=1001)
                    return
        except asyncio.CancelledError:
            raise
        except Exception:
            if not self._closed:
                await self.close(code=1001)

    async def _notify_disconnect(self, code: int) -> None:
        if self._disconnect_notified or self.on_disconnect is None:
            return

        self._disconnect_notified = True
        result = self.on_disconnect(code, self.connection_duration)
        if inspect.isawaitable(result):
            await result

    def _is_pong_message(self, message: Message) -> bool:
        return (
            message.get("text") == self.pong_payload.decode("utf-8")
            or message.get("bytes") == self.pong_payload
        )
