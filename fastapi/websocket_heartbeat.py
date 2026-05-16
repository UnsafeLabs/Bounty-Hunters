"""WebSocketWithHeartbeat with ping/pong keepalive"""
import asyncio, time
from typing import Optional, Callable

class WebSocketWithHeartbeat:
    def __init__(self, ws, ping_interval=25, pong_timeout=10, on_disconnect=None):
        self.ws = ws; self.ping_interval = ping_interval; self.pong_timeout = pong_timeout
        self.on_disconnect = on_disconnect; self._last_pong = time.monotonic()
        self._running = False; self._task = None; self._connect_count = 0

    async def start(self):
        self._running = True; self._last_pong = time.monotonic()
        self._task = asyncio.create_task(self._loop()); self._connect_count += 1

    async def stop(self):
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try: await self._task
            except asyncio.CancelledError: pass
            self._task = None
        if self.on_disconnect: await self.on_disconnect()

    async def _loop(self):
        while self._running:
            await asyncio.sleep(self.ping_interval)
            if not self._running: break
            try: await self.ws.ping(); self._last_pong = time.monotonic()
            except Exception:
                if self._running: await self.stop()
                break

    def is_alive(self):
        return self._running and (time.monotonic() - self._last_pong) < (self.ping_interval + self.pong_timeout)

    @property
    def connect_count(self): return self._connect_count
