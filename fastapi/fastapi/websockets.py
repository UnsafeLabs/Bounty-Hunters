from __future__ import annotations

import asyncio
import time
from typing import Any, Callable, Optional

from starlette.websockets import WebSocket, WebSocketDisconnect, WebSocketState


class WebSocketWithHeartbeat:
    def __init__(
        self,
        websocket: WebSocket,
        heartbeat_interval: float = 30.0,
        heartbeat_timeout: float = 10.0,
        on_heartbeat_missed: Optional[Callable[[], Any]] = None,
    ):
        self.websocket = websocket
        self.heartbeat_interval = heartbeat_interval
        self.heartbeat_timeout = heartbeat_timeout
        self.on_heartbeat_missed = on_heartbeat_missed
        self._last_pong: float = 0.0
        self._heartbeat_task: Optional[asyncio.Task] = None
        self._connect_count = 0

    async def accept(self):
        await self.websocket.accept()
        self._last_pong = time.monotonic()
        self._connect_count += 1
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

    async def _heartbeat_loop(self):
        while self.websocket.client_state != WebSocketState.DISCONNECTED:
            await asyncio.sleep(self.heartbeat_interval)
            if self.websocket.client_state == WebSocketState.DISCONNECTED:
                break
            try:
                await self.websocket.send_json({"type": "ping"})
                elapsed = time.monotonic() - self._last_pong
                if elapsed > self.heartbeat_timeout:
                    if self.on_heartbeat_missed:
                        self.on_heartbeat_missed()
                    await self.websocket.close(code=1001)
                    break
            except (WebSocketDisconnect, RuntimeError):
                break

    async def receive_json(self, mode: str = "text"):
        try:
            data = await self.websocket.receive_json(mode=mode)
            if isinstance(data, dict) and data.get("type") == "pong":
                self._last_pong = time.monotonic()
                return await self.receive_json(mode=mode)
            return data
        except WebSocketDisconnect:
            raise

    async def send_json(self, data: Any, mode: str = "text"):
        await self.websocket.send_json(data, mode=mode)

    async def close(self, code: int = 1000):
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            try:
                await self._heartbeat_task
            except asyncio.CancelledError:
                pass
        await self.websocket.close(code=code)

    @property
    def connect_count(self) -> int:
        return self._connect_count
