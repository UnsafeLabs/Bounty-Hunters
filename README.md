import asyncio
import time
from typing import Callable, Optional
from starlette.websockets import WebSocket as WebSocket  # noqa
from starlette.websockets import WebSocketDisconnect as WebSocketDisconnect  # noqa
from starlette.websockets import WebSocketState as WebSocketState  # noqa

class WebSocketWithHeartbeat:
    def __init__(
        self, 
        websocket: WebSocket, 
        ping_interval: float = 30.0, 
        pong_timeout: float = 10.0,
        on_disconnect: Optional[Callable[[int, float], None]] = None
    ):
        self.websocket = websocket
        self.ping_interval = ping_interval
        self.pong_timeout = pong_timeout
        self.on_disconnect = on_disconnect
        self.start_time = time.time()
        self.message_count = 0
        self._task: Optional[asyncio.Task] = None

    @property
    def connection_duration(self) -> float:
        return time.time() - self.start_time

    async def __aenter__(self):
        await self.websocket.accept()
        self._task = asyncio.create_task(self._heartbeat_loop())
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._task:
            self._task.cancel()
        duration = self.connection_duration
        if self.on_disconnect:
            self.on_disconnect(1000, duration)
        await self.websocket.close()

    async def _heartbeat_loop(self):
        try:
            while True:
                await asyncio.sleep(self.ping_interval)
                try:
                    await asyncio.wait_for(self.websocket.send_bytes(b''), timeout=self.pong_timeout)
                except (asyncio.TimeoutError, Exception):
                    await self.websocket.close(code=1001)
                    break
        except asyncio.CancelledError:
            pass

    async def receive_text(self):
        self.message_count += 1
        return await self.websocket.receive_text()
