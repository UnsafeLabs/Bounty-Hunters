import asyncio
import inspect
import json
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import suppress
from typing import Any, cast

from starlette.types import Message
from starlette.websockets import WebSocket as WebSocket  # noqa
from starlette.websockets import WebSocketDisconnect as WebSocketDisconnect  # noqa
from starlette.websockets import WebSocketState as WebSocketState  # noqa

DisconnectCallback = Callable[[int, float], Awaitable[Any] | Any]


class WebSocketWithHeartbeat:
    """Add an application-level heartbeat and connection metrics to a WebSocket.

    ASGI does not expose protocol-level ping and pong control frames. This wrapper
    therefore sends ``ping_message`` as a binary WebSocket message and consumes a
    matching ``pong_message`` received from the client.
    """

    def __init__(
        self,
        websocket: WebSocket,
        *,
        ping_interval: float = 30.0,
        pong_timeout: float = 10.0,
        on_disconnect: DisconnectCallback | None = None,
        ping_message: bytes = b"ping",
        pong_message: bytes = b"pong",
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
        self._started_at = time.monotonic()
        self._ended_at: float | None = None
        self._message_count = 0
        self._pong_received = asyncio.Event()
        self._heartbeat_task: asyncio.Task[None] | None = None
        self._closed = False
        self._disconnect_notified = False

    def __getattr__(self, name: str) -> Any:
        return getattr(self.websocket, name)

    @property
    def connection_duration(self) -> float:
        ended_at = self._ended_at
        if ended_at is None:
            ended_at = time.monotonic()
        return ended_at - self._started_at

    @property
    def message_count(self) -> int:
        """Return the number of non-heartbeat messages received from the client."""
        return self._message_count

    async def accept(
        self,
        subprotocol: str | None = None,
        headers: list[tuple[bytes, bytes]] | None = None,
    ) -> None:
        await self.websocket.accept(subprotocol=subprotocol, headers=headers)
        self._started_at = time.monotonic()
        self.start_heartbeat()

    def start_heartbeat(self) -> None:
        if self._closed:
            raise RuntimeError("Cannot start heartbeat on a closed WebSocket")
        if self._heartbeat_task is None or self._heartbeat_task.done():
            self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

    async def stop_heartbeat(self) -> None:
        task = self._heartbeat_task
        if task is None or task.done() or task is asyncio.current_task():
            return
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        if self._closed:
            return
        self._mark_closed()
        await self.stop_heartbeat()
        try:
            await self.websocket.close(code=code, reason=reason)
        finally:
            await self._notify_disconnect(code)

    async def receive(self) -> Message:
        while True:
            try:
                message = await self.websocket.receive()
            except WebSocketDisconnect as exc:
                await self._handle_disconnect(exc.code)
                raise

            if message["type"] == "websocket.disconnect":
                await self._handle_disconnect(int(message.get("code", 1000)))
                return message
            if self._is_pong(message):
                self._pong_received.set()
                continue

            if message["type"] == "websocket.receive":
                self._message_count += 1
            return message

    async def receive_text(self) -> str:
        message = await self.receive()
        self._raise_on_disconnect(message)
        return cast(str, message["text"])

    async def receive_bytes(self) -> bytes:
        message = await self.receive()
        self._raise_on_disconnect(message)
        return cast(bytes, message["bytes"])

    async def receive_json(self, mode: str = "text") -> Any:
        if mode not in {"text", "binary"}:
            raise RuntimeError('The "mode" argument should be "text" or "binary".')
        message = await self.receive()
        self._raise_on_disconnect(message)
        if mode == "text":
            text = message["text"]
        else:
            text = message["bytes"].decode("utf-8")
        return json.loads(text)

    async def iter_text(self) -> AsyncIterator[str]:
        try:
            while True:
                yield await self.receive_text()
        except WebSocketDisconnect:
            pass

    async def iter_bytes(self) -> AsyncIterator[bytes]:
        try:
            while True:
                yield await self.receive_bytes()
        except WebSocketDisconnect:
            pass

    async def iter_json(self) -> AsyncIterator[Any]:
        try:
            while True:
                yield await self.receive_json()
        except WebSocketDisconnect:
            pass

    async def _heartbeat_loop(self) -> None:
        try:
            while not self._closed:
                await asyncio.sleep(self.ping_interval)
                if self._closed:
                    return
                if self.websocket.application_state != WebSocketState.CONNECTED:
                    continue
                self._pong_received.clear()
                try:
                    await self.websocket.send_bytes(self.ping_message)
                except Exception as exc:
                    await self._handle_send_error(exc)
                    return
                try:
                    await asyncio.wait_for(
                        self._pong_received.wait(), timeout=self.pong_timeout
                    )
                except TimeoutError:
                    await self._close_for_timeout()
                    return
        except asyncio.CancelledError:
            raise
        except WebSocketDisconnect as exc:
            await self._handle_disconnect(exc.code)

    async def _handle_send_error(self, exc: Exception) -> None:
        self._mark_closed()
        try:
            await self.websocket.close(code=1001, reason="Heartbeat send failed")
        finally:
            await self._notify_disconnect(1001)

    async def _close_for_timeout(self) -> None:
        self._mark_closed()
        try:
            await self.websocket.close(code=1001, reason="Pong timeout")
        finally:
            await self._notify_disconnect(1001)

    async def _handle_disconnect(self, code: int) -> None:
        self._mark_closed()
        await self.stop_heartbeat()
        await self._notify_disconnect(code)

    def _mark_closed(self) -> None:
        if not self._closed:
            self._closed = True
            self._ended_at = time.monotonic()

    async def _notify_disconnect(self, code: int) -> None:
        if self._disconnect_notified:
            return
        self._disconnect_notified = True
        if self.on_disconnect is None:
            return
        result = self.on_disconnect(code, self.connection_duration)
        if inspect.isawaitable(result):
            await result

    def _is_pong(self, message: Message) -> bool:
        return (
            message["type"] == "websocket.receive"
            and message.get("bytes") == self.pong_message
        )

    @staticmethod
    def _raise_on_disconnect(message: Message) -> None:
        if message["type"] == "websocket.disconnect":
            raise WebSocketDisconnect(
                int(message.get("code", 1000)), message.get("reason")
            )
