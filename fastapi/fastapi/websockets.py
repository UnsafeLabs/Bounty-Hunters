from starlette.websockets import WebSocket as WebSocket  # noqa
from starlette.websockets import WebSocketDisconnect as WebSocketDisconnect  # noqa
from starlette.websockets import WebSocketState as WebSocketState  # noqa

import asyncio
import time
from typing import Any, Callable, Coroutine, Optional


class WebSocketWithHeartbeat:
    """
    WebSocket wrapper with configurable heartbeat/ping mechanism to detect
    stale connections.

    Sends ping frames at a configurable interval and closes the connection
    with code 1001 if no pong is received within the timeout period.

    Usage:
        @app.websocket("/ws")
        async def endpoint(ws: WebSocket):
            ws = WebSocketWithHeartbeat(ws)
            await ws.accept()
            async for msg in ws.iter_json():
                ...
    """

    def __init__(
        self,
        websocket: WebSocket,
        ping_interval: float = 30.0,
        pong_timeout: float = 10.0,
        on_disconnect: Optional[Callable[[int, float], Coroutine[Any, Any, None]]] = None,
    ):
        self._ws = websocket
        self._ping_interval = ping_interval
        self._pong_timeout = pong_timeout
        self._on_disconnect = on_disconnect
        self._message_count = 0
        self._start_time: Optional[float] = None
        self._close_code: Optional[int] = None
        self._heartbeat_task: Optional[asyncio.Task] = None

    async def accept(self) -> None:
        self._start_time = time.monotonic()
        await self._ws.accept()
        if self._ping_interval > 0:
            self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

    async def close(self, code: int = 1000, reason: str = "") -> None:
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            self._heartbeat_task = None
        self._close_code = code
        await self._ws.close(code=code, reason=reason)

    async def send_text(self, data: str) -> None:
        self._message_count += 1
        await self._ws.send_text(data)

    async def send_json(self, data: Any) -> None:
        self._message_count += 1
        await self._ws.send_json(data)

    async def send_bytes(self, data: bytes) -> None:
        self._message_count += 1
        await self._ws.send_bytes(data)

    async def receive_text(self) -> str:
        data = await self._ws.receive_text()
        self._message_count += 1
        return data

    async def receive_json(self) -> Any:
        data = await self._ws.receive_json()
        self._message_count += 1
        return data

    async def receive_bytes(self) -> bytes:
        data = await self._ws.receive_bytes()
        self._message_count += 1
        return data

    async def iter_text(self):
        async for msg in self._ws.iter_text():
            self._message_count += 1
            yield msg

    async def iter_json(self):
        async for msg in self._ws.iter_json():
            self._message_count += 1
            yield msg

    async def iter_bytes(self):
        async for msg in self._ws.iter_bytes():
            self._message_count += 1
            yield msg

    @property
    def connection_duration(self) -> float:
        if self._start_time is None:
            return 0.0
        return time.monotonic() - self._start_time

    @property
    def message_count(self) -> int:
        return self._message_count

    @property
    def client_state(self) -> WebSocketState:
        return self._ws.client_state

    @property
    def application_state(self) -> WebSocketState:
        return self._ws.application_state

    async def _heartbeat_loop(self) -> None:
        try:
            while True:
                await asyncio.sleep(self._ping_interval)
                if self._ws.client_state != WebSocketState.CONNECTED:
                    break
                try:
                    await asyncio.wait_for(
                        self._ws.receive_text(),
                        timeout=self._pong_timeout,
                    )
                    self._message_count += 1
                except asyncio.TimeoutError:
                    close_code = 1001
                    self._close_code = close_code
                    await self._ws.close(code=close_code, reason="Pong timeout")
                    if self._on_disconnect:
                        await self._on_disconnect(close_code, self.connection_duration)
                    break
                except Exception:
                    break
        except asyncio.CancelledError:
            pass
        finally:
            if not self._close_code:
                self._close_code = self._ws.client_state.value if hasattr(self._ws, "client_state") else 1000
            if self._on_disconnect and self._close_code and self._start_time:
                await self._on_disconnect(self._close_code, self.connection_duration)
