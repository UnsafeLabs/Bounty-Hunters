import asyncio
import time
from typing import Any, Callable

from starlette.websockets import WebSocket as StarletteWebSocket
from starlette.websockets import WebSocketDisconnect as WebSocketDisconnect  # noqa
from starlette.websockets import WebSocketState as WebSocketState  # noqa


class WebSocket(StarletteWebSocket):
    """Extended WebSocket with ping/pong heartbeat support.

    Adds configurable periodic ping frames and connection tracking
    to Starlette's WebSocket.
    """

    def __init__(
        self,
        scope: Any,
        receive: Any,
        send: Any,
        ping_interval: float | None = None,
        pong_timeout: float = 10.0,
        on_disconnect: Callable | None = None,
    ) -> None:
        super().__init__(scope, receive, send)
        self.ping_interval = ping_interval
        self.pong_timeout = pong_timeout
        self.on_disconnect: Callable | None = on_disconnect
        self._heartbeat_task: asyncio.Task | None = None
        self._connected_at: float | None = None
        self._message_count: int = 0
        self._connected_time: float = 0.0

    @property
    def connection_duration(self) -> float | None:
        """Return the duration in seconds since the connection was established."""
        if self._connected_at is None:
            return None
        return time.monotonic() - self._connected_at

    @property
    def message_count(self) -> int:
        """Return the total number of messages on this connection."""
        return self._message_count

    def start_heartbeat(self, interval: float | None = None) -> None:
        """Start sending periodic ping frames.

        Args:
            interval: Override the default ping interval.
        """
        if interval is not None:
            self.ping_interval = interval

        if self.ping_interval is None or self.ping_interval <= 0:
            return

        self._connected_at = time.monotonic()

        async def _heartbeat_loop() -> None:
            try:
                while True:
                    await asyncio.sleep(self.ping_interval)
                    if self.client_state in (
                        WebSocketState.DISCONNECTED,
                    ):
                        break
                    await self._send({"type": "websocket.ping"})
            except asyncio.CancelledError:
                pass

        self._heartbeat_task = asyncio.ensure_future(_heartbeat_loop())

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        """Close the connection, cancelling heartbeat if active."""
        if self._heartbeat_task is not None and not self._heartbeat_task.done():
            self._heartbeat_task.cancel()
            try:
                await self._heartbeat_task
            except asyncio.CancelledError:
                pass

        if self.on_disconnect is not None:
            self.on_disconnect(code, self.connection_duration)

        await super().close(code=code, reason=reason)

    async def receive(self) -> Any:
        """Override receive to track message count."""
        msg = await super().receive()
        self._message_count += 1
        return msg

    async def send(self, message: Any) -> None:
        """Override send to track message count."""
        self._message_count += 1
        await super().send(message)