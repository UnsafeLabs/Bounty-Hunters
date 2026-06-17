import asyncio
import time
from typing import Any, Callable, Optional

from starlette.websockets import WebSocket as _StarletteWebSocket
from starlette.websockets import WebSocketDisconnect as WebSocketDisconnect  # noqa
from starlette.websockets import WebSocketState as WebSocketState  # noqa

WebSocket = _StarletteWebSocket  # noqa


class WebSocketWithHeartbeat(_StarletteWebSocket):
    """WebSocket wrapper with configurable heartbeat/ping mechanism."""

    def __init__(
        self,
        websocket: _StarletteWebSocket,
        ping_interval: float = 30.0,
        pong_timeout: float = 10.0,
        on_disconnect: Optional[Callable[[int, float], None]] = None,
    ) -> None:
        super().__init__(websocket.scope, websocket.receive, websocket.send)
        self._ping_interval = ping_interval
        self._pong_timeout = pong_timeout
        self._on_disconnect = on_disconnect
        self._connection_start = time.time()
        self._message_count = 0
        self._heartbeat_task: Optional[asyncio.Task] = None
        self._closed = False

    @property
    def connection_duration(self) -> float:
        """Return connection duration in seconds."""
        return time.time() - self._connection_start

    @property
    def message_count(self) -> int:
        """Return number of messages received."""
        return self._message_count

    async def receive(self) -> dict[str, Any]:
        """Override receive to track message count."""
        message = await super().receive()
        if message.get("type") == "websocket.receive":
            self._message_count += 1
        return message

    async def _ping_loop(self) -> None:
        """Send ping frames at configured interval."""
        try:
            while not self._closed and self.client_state == WebSocketState.CONNECTED:
                await asyncio.sleep(self._ping_interval)
                if self._closed or self.client_state != WebSocketState.CONNECTED:
                    break
                try:
                    await self.send_text("")
                except Exception:
                    self._close_with_code(1001)
                    break
        except asyncio.CancelledError:
            pass

    def _close_with_code(self, code: int) -> None:
        """Close connection with specific code and fire callback."""
        if self._closed:
            return
        self._closed = True
        duration = self.connection_duration
        try:
            asyncio.get_event_loop().run_coroutine_sync(self.close(code=code))
        except Exception:
            pass
        if self._on_disconnect:
            self._on_disconnect(code, duration)

    def start_heartbeat(self) -> None:
        """Start the heartbeat ping loop."""
        if self._heartbeat_task is None or self._heartbeat_task.done():
            self._heartbeat_task = asyncio.create_task(self._ping_loop())

    def stop_heartbeat(self) -> None:
        """Stop the heartbeat ping loop."""
        if self._heartbeat_task and not self._heartbeat_task.done():
            self._heartbeat_task.cancel()

    async def accept(self, *args: Any, **kwargs: Any) -> None:
        """Accept connection and start heartbeat."""
        await super().accept(*args, **kwargs)
        self.start_heartbeat()

    async def close(self, code: int = 1000) -> None:  # type: ignore[override]
        """Close connection and stop heartbeat."""
        self.stop_heartbeat()
        self._closed = True
        await super().close(code=code)
        if self._on_disconnect:
            self._on_disconnect(code, self.connection_duration)
