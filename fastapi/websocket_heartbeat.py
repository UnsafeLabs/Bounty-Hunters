"""WebSocket with heartbeat and edge case handling"""
import asyncio, time, logging
from typing import Optional, Callable

logger = logging.getLogger("fastapi.websocket")

class WebSocketWithHeartbeat:
    def __init__(self, heartbeat_interval: float = 30.0, timeout: float = 90.0):
        self._interval = heartbeat_interval
        self._timeout = timeout
        self._last_pong = time.time()
        self._task: Optional[asyncio.Task] = None
        self._on_disconnect: Optional[Callable] = None
        self._connect_count = 0

    @property
    def connect_count(self) -> int: return self._connect_count

    def on_disconnect(self, callback: Callable): self._on_disconnect = callback

    async def start(self):
        self._connect_count += 1
        self._last_pong = time.time()
        self._task = asyncio.create_task(self._heartbeat_loop())

    async def stop(self):
        if self._task:
            self._task.cancel()
            try: await self._task
            except asyncio.CancelledError: pass
        if self._on_disconnect:
            await self._on_disconnect()

    async def pong(self):
        self._last_pong = time.time()

    async def _heartbeat_loop(self):
        while True:
            await asyncio.sleep(self._interval)
            if time.time() - self._last_pong > self._timeout:
                logger.warning("WebSocket heartbeat timeout")
                break
