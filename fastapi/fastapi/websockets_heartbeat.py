"""
WebSocket with built-in heartbeat for connection health monitoring.
"""
import asyncio
from typing import Optional, Callable, Any
from starlette.websockets import WebSocket, WebSocketDisconnect
import json
import time


class WebSocketWithHeartbeat:
    """
    WebSocket wrapper with automatic ping/pong heartbeat.

    Features:
    - Configurable ping interval
    - Automatic disconnect on timeout
    - Connection health monitoring
    - Custom message handlers
    """

    def __init__(
        self,
        websocket: WebSocket,
        ping_interval: int = 30,
        ping_timeout: int = 10,
        max_missed_pings: int = 3,
    ):
        self.ws = websocket
        self.ping_interval = ping_interval
        self.ping_timeout = ping_timeout
        self.max_missed_pings = max_missed_pings
        self._last_pong = time.time()
        self._missed_pings = 0
        self._connected = False
        self._heartbeat_task: Optional[asyncio.Task] = None

    async def accept(self, subprotocol: str = None) -> None:
        """Accept WebSocket connection and start heartbeat."""
        await self.ws.accept(subprotocol)
        self._connected = True
        self._last_pong = time.time()
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

    async def close(self, code: int = 1000, reason: str = None) -> None:
        """Close connection and stop heartbeat."""
        self._connected = False
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            try:
                await self._heartbeat_task
            except asyncio.CancelledError:
                pass
        await self.ws.close(code, reason)

    async def send_json(self, data: Any) -> None:
        """Send JSON data."""
        await self.ws.send_json(data)

    async def receive_json(self) -> Any:
        """Receive JSON data, handling ping/pong internally."""
        while True:
            message = await self.ws.receive()

            if message["type"] == "websocket.receive":
                data = message.get("text", "")
                # Handle pong response
                if data == "pong" or data == '{"type":"pong"}':
                    self._last_pong = time.time()
                    self._missed_pings = 0
                    continue
                # Try to parse as JSON
                try:
                    return json.loads(data)
                except json.JSONDecodeError:
                    return data

            elif message["type"] == "websocket.disconnect":
                self._connected = False
                raise WebSocketDisconnect()

    async def _heartbeat_loop(self) -> None:
        """Background heartbeat loop."""
        try:
            while self._connected:
                await asyncio.sleep(self.ping_interval)

                if not self._connected:
                    break

                # Send ping
                try:
                    await self.ws.send_text("ping")
                    self._missed_pings += 1
                except Exception:
                    self._connected = False
                    break

                # Check timeout
                if self._missed_pings >= self.max_missed_pings:
                    self._connected = False
                    try:
                        await self.ws.close(code=1001, reason="Heartbeat timeout")
                    except Exception:
                        pass
                    break

        except asyncio.CancelledError:
            pass

    @property
    def is_connected(self) -> bool:
        """Check if connection is alive."""
        return self._connected

    @property
    def latency(self) -> Optional[float]:
        """Get approximate latency based on last pong time."""
        if self._last_pong:
            return time.time() - self._last_pong
        return None
