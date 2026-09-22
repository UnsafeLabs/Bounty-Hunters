"""WebSocket helpers, including an opt-in application-level heartbeat.

The ASGI WebSocket specification does not expose a portable ping/pong API.
This wrapper therefore uses a server implementation's ``send_ping`` and
``wait_pong`` methods when available, and otherwise sends the conventional
ASGI ``websocket.ping`` extension message.
"""

from __future__ import annotations

import asyncio
import inspect
import time
from collections.abc import Awaitable, Callable
from typing import Any


DisconnectCallback = Callable[[int, float], Any]


class WebSocketWithHeartbeat:
    """Wrap a WebSocket and monitor it with periodic ping/pong checks.

    Heartbeat starts when the wrapper is entered as an async context manager,
    or explicitly via :meth:`start`.  The underlying WebSocket remains
    accessible through normal attribute delegation.
    """

    DEFAULT_PING_INTERVAL = 30.0
    DEFAULT_PONG_TIMEOUT = 10.0

    def __init__(
        self,
        websocket: Any,
        *,
        ping_interval: float = DEFAULT_PING_INTERVAL,
        pong_timeout: float = DEFAULT_PONG_TIMEOUT,
        on_disconnect: DisconnectCallback | None = None,
    ) -> None:
        if ping_interval <= 0 or pong_timeout <= 0:
            raise ValueError("ping_interval and pong_timeout must be positive")
        self.websocket = websocket
        self.ping_interval = float(ping_interval)
        self.pong_timeout = float(pong_timeout)
        self.on_disconnect = on_disconnect
        self._started_at: float | None = None
        self._message_count = 0
        self._heartbeat_task: asyncio.Task[None] | None = None
        self._disconnect_notified = False

    def __getattr__(self, name: str) -> Any:
        return getattr(self.websocket, name)

    @property
    def connection_duration(self) -> float:
        return 0.0 if self._started_at is None else max(0.0, time.monotonic() - self._started_at)

    @property
    def message_count(self) -> int:
        return self._message_count

    async def start(self) -> "WebSocketWithHeartbeat":
        if self._started_at is None:
            self._started_at = time.monotonic()
        if self._heartbeat_task is None or self._heartbeat_task.done():
            self._heartbeat_task = asyncio.create_task(self._heartbeat())
        return self

    async def __aenter__(self) -> "WebSocketWithHeartbeat":
        return await self.start()

    async def stop(self) -> None:
        task, self._heartbeat_task = self._heartbeat_task, None
        if task is not None and task is not asyncio.current_task():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def __aexit__(self, *_: Any) -> None:
        await self.stop()

    async def receive(self) -> Any:
        try:
            message = await self.websocket.receive()
        except Exception as exc:
            await self._notify_disconnect(getattr(exc, "code", 1000))
            raise
        self._message_count += 1
        return message

    async def receive_text(self) -> str:
        try:
            value = await self.websocket.receive_text()
        except Exception as exc:
            await self._notify_disconnect(getattr(exc, "code", 1000))
            raise
        self._message_count += 1
        return value

    async def receive_bytes(self) -> bytes:
        try:
            value = await self.websocket.receive_bytes()
        except Exception as exc:
            await self._notify_disconnect(getattr(exc, "code", 1000))
            raise
        self._message_count += 1
        return value

    async def receive_json(self, *args: Any, **kwargs: Any) -> Any:
        try:
            value = await self.websocket.receive_json(*args, **kwargs)
        except Exception as exc:
            await self._notify_disconnect(getattr(exc, "code", 1000))
            raise
        self._message_count += 1
        return value

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        await self.stop()
        try:
            if reason is None:
                await self.websocket.close(code=code)
            else:
                await self.websocket.close(code=code, reason=reason)
        finally:
            await self._notify_disconnect(code)

    async def _heartbeat(self) -> None:
        try:
            while True:
                await asyncio.sleep(self.ping_interval)
                await self._send_ping()
                if not await self._wait_for_pong():
                    await self.close(code=1001)
                    return
        except asyncio.CancelledError:
            raise
        except Exception:
            await self._notify_disconnect(1001)

    async def _send_ping(self) -> None:
        method = getattr(self.websocket, "send_ping", None)
        if method is not None:
            result = method()
        else:
            result = self.websocket.send({"type": "websocket.ping"})
        if inspect.isawaitable(result):
            await result

    async def _wait_for_pong(self) -> bool:
        method = getattr(self.websocket, "wait_pong", None)
        if method is None:
            return True  # ASGI servers may handle extension pongs internally.
        try:
            result = method(self.pong_timeout)
            if inspect.isawaitable(result):
                result = await asyncio.wait_for(result, self.pong_timeout)
            return result is not False
        except (asyncio.TimeoutError, TimeoutError):
            return False

    async def _notify_disconnect(self, code: int) -> None:
        if self._disconnect_notified or self.on_disconnect is None:
            return
        self._disconnect_notified = True
        result = self.on_disconnect(code, self.connection_duration)
        if inspect.isawaitable(result):
            await result
