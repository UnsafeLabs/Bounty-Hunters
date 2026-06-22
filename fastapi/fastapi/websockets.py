import asyncio
import time
from typing import Any, Callable, Optional

from fastapi import WebSocket, WebSocketDisconnect, status


class WebSocketWithHeartbeat:
    """WebSocket wrapper with heartbeat/ping mechanism."""

    def __init__(
        self,
        websocket: WebSocket,
        ping_interval: float = 30.0,
        pong_timeout: float = 10.0,
        on_disconnect: Optional[Callable[[int, float], None]] = None,
    ):
        self.websocket = websocket
        self.ping_interval = ping_interval
        self.pong_timeout = pong_timeout
        self.on_disconnect = on_disconnect
        self._connected = True
        self._start_time = time.time()
        self._message_count = 0

    @property
    def connection_duration(self) -> float:
        return time.time() - self._start_time if self._connected else 0.0

    @property
    def message_count(self) -> int:
        return self._message_count

    async def _heartbeat_loop(self):
        while self._connected:
            await asyncio.sleep(self.ping_interval)
            if not self._connected:
                break
            try:
                await asyncio.wait_for(
                    self.websocket.send_json({"type": "ping"}),
                    timeout=self.pong_timeout,
                )
            except asyncio.TimeoutError:
                self._connected = False
                if self.on_disconnect:
                    self.on_disconnect(
                        status.WS_1001_ENDPOINT_UNAVAILABLE,
                        self.connection_duration,
                    )
                break

    async def receive_text(self) -> str:
        data = await self.websocket.receive_text()
        self._message_count += 1
        return data

    async def receive_json(self) -> Any:
        data = await self.websocket.receive_json()
        self._message_count += 1
        return data

    async def send_text(self, data: str) -> None:
        await self.websocket.send_text(data)

    async def send_json(self, data: Any) -> None:
        await self.websocket.send_json(data)

    async def close(self, code: int = 1000) -> None:
        self._connected = False
        await self.websocket.close(code)

    async def run_with_heartbeat(self, handler: Callable):
        """Run the heartbeat loop alongside the handler."""
        try:
            heartbeat_task = asyncio.create_task(self._heartbeat_loop())
            await handler(self)
            heartbeat_task.cancel()
        except WebSocketDisconnect:
            pass
        finally:
            self._connected = False
            if self.on_disconnect and hasattr(self, "_start_time"):
                self.on_disconnect(1000, self.connection_duration)
