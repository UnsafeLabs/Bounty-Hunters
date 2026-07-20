"""WebSocket heartbeat wrapper with ping/pong timeout (issue #766)."""

from __future__ import annotations

import asyncio
import time
from typing import Any, Awaitable, Callable, Optional

DEFAULT_PING_INTERVAL = 30.0
DEFAULT_PONG_TIMEOUT = 10.0
CLOSE_CODE_GOING_AWAY = 1001

OnDisconnect = Callable[[int, float], Any]


class WebSocketWithHeartbeat:
    """
    Wrap a WebSocket-like object with configurable heartbeat.

    Sends ping frames every ``ping_interval`` seconds. If no pong within
    ``pong_timeout``, closes with code 1001 and fires ``on_disconnect``.
    """

    def __init__(
        self,
        websocket: Any,
        *,
        ping_interval: float = DEFAULT_PING_INTERVAL,
        pong_timeout: float = DEFAULT_PONG_TIMEOUT,
        on_disconnect: Optional[OnDisconnect] = None,
        now: Optional[Callable[[], float]] = None,
    ) -> None:
        self.websocket = websocket
        self.ping_interval = float(ping_interval)
        self.pong_timeout = float(pong_timeout)
        self.on_disconnect = on_disconnect
        self._now = now or time.monotonic
        self._started_at = self._now()
        self._message_count = 0
        self._last_pong_at = self._started_at
        self._closed = False
        self._close_code: Optional[int] = None
        self._heartbeat_task: Optional[asyncio.Task] = None

    @property
    def connection_duration(self) -> float:
        end = self._now() if not self._closed else (self._close_time if hasattr(self, "_close_time") else self._now())
        return max(0.0, end - self._started_at)

    @property
    def message_count(self) -> int:
        return self._message_count

    def record_message(self) -> None:
        self._message_count += 1

    def record_pong(self) -> None:
        self._last_pong_at = self._now()

    async def start_heartbeat(self) -> None:
        if self._heartbeat_task is not None:
            return
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

    async def stop_heartbeat(self) -> None:
        if self._heartbeat_task is not None:
            self._heartbeat_task.cancel()
            try:
                await self._heartbeat_task
            except asyncio.CancelledError:
                pass
            self._heartbeat_task = None

    async def _heartbeat_loop(self) -> None:
        try:
            while not self._closed:
                await asyncio.sleep(self.ping_interval)
                if self._closed:
                    break
                await self._send_ping()
                # wait for pong window
                deadline = self._now() + self.pong_timeout
                while self._now() < deadline and not self._closed:
                    if self._last_pong_at >= deadline - self.pong_timeout:
                        # pong received after ping (updated)
                        if self._last_pong_at > deadline - self.pong_timeout - 0.001:
                            break
                    await asyncio.sleep(0.05)
                else:
                    # check timeout
                    if self._now() - self._last_pong_at >= self.pong_timeout:
                        await self.close(CLOSE_CODE_GOING_AWAY)
                        return
        except asyncio.CancelledError:
            return

    async def _send_ping(self) -> None:
        # Mark ping time; pong must arrive after this for success path in tests.
        self._ping_sent_at = self._now()
        send_ping = getattr(self.websocket, "send_ping", None)
        if callable(send_ping):
            result = send_ping()
            if asyncio.iscoroutine(result) or isinstance(result, Awaitable):
                await result  # type: ignore[arg-type]
            return
        # fallback: application-level ping message
        send_text = getattr(self.websocket, "send_text", None)
        if callable(send_text):
            result = send_text('{"type":"ping"}')
            if asyncio.iscoroutine(result):
                await result

    async def close(self, code: int = CLOSE_CODE_GOING_AWAY) -> None:
        if self._closed:
            return
        self._closed = True
        self._close_code = code
        self._close_time = self._now()
        duration = self.connection_duration
        close = getattr(self.websocket, "close", None)
        if callable(close):
            result = close(code=code)
            if asyncio.iscoroutine(result):
                await result
        if self.on_disconnect is not None:
            result = self.on_disconnect(code, duration)
            if asyncio.iscoroutine(result):
                await result
        await self.stop_heartbeat()

    async def receive_text(self) -> str:
        data = await self.websocket.receive_text()
        self.record_message()
        if data == "pong" or '"type":"pong"' in data.replace(" ", ""):
            self.record_pong()
        return data


# Simpler pure logic helpers for unit tests without full asyncio starlette
class HeartbeatTracker:
    """Synchronous heartbeat state machine for tests."""

    def __init__(
        self,
        ping_interval: float = DEFAULT_PING_INTERVAL,
        pong_timeout: float = DEFAULT_PONG_TIMEOUT,
        now: Optional[Callable[[], float]] = None,
    ) -> None:
        self.ping_interval = ping_interval
        self.pong_timeout = pong_timeout
        self._now = now or time.monotonic
        self.started_at = self._now()
        self.message_count = 0
        self.last_pong_at = self.started_at
        self.last_ping_at: Optional[float] = None
        self.closed = False
        self.close_code: Optional[int] = None
        self.pings_sent = 0

    @property
    def connection_duration(self) -> float:
        return self._now() - self.started_at

    def send_ping(self) -> None:
        self.last_ping_at = self._now()
        self.pings_sent += 1

    def on_pong(self) -> None:
        self.last_pong_at = self._now()

    def on_message(self) -> None:
        self.message_count += 1

    def should_close_for_timeout(self) -> bool:
        if self.last_ping_at is None:
            return False
        return (self._now() - self.last_pong_at) >= self.pong_timeout and (
            self._now() - self.last_ping_at
        ) >= self.pong_timeout

    def close(self, code: int = CLOSE_CODE_GOING_AWAY) -> None:
        self.closed = True
        self.close_code = code
