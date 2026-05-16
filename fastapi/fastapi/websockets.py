from __future__ import annotations

import asyncio as _asyncio
import time as _time
from collections.abc import Callable
from typing import Annotated, Any, Optional

from annotated_doc import Doc
from starlette.websockets import WebSocket as WebSocket  # noqa
from starlette.websockets import WebSocketDisconnect as WebSocketDisconnect  # noqa
from starlette.websockets import WebSocketState as WebSocketState  # noqa


class WebSocketWithHeartbeat:
    """WebSocket wrapper with heartbeat/ping mechanism for stale connection detection.

    Sends ping frames at a configurable interval and closes the connection
    if no pong is received within the timeout period.

    Usage:

    ```python
    from fastapi import FastAPI
    from fastapi.websockets import WebSocketWithHeartbeat

    app = FastAPI()

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        ws = WebSocketWithHeartbeat(
            websocket,
            ping_interval=30,
            pong_timeout=10,
            on_disconnect=lambda code, duration: print(f"Disconnected: {code} after {duration}s"),
        )
        await ws.accept()
        try:
            await ws.run_heartbeat()
        except Exception:
            pass
    ```
    """

    def __init__(
        self,
        websocket: Annotated[
            WebSocket,
            Doc("The underlying WebSocket connection."),
        ],
        ping_interval: Annotated[
            int,
            Doc(
                """
                Interval in seconds between ping frames.
                Defaults to 30.
                """
            ),
        ] = 30,
        pong_timeout: Annotated[
            int,
            Doc(
                """
                Seconds to wait for pong before closing the connection.
                Defaults to 10.
                """
            ),
        ] = 10,
        on_disconnect: Annotated[
            Optional[Callable[[int, float], Any]],
            Doc(
                """
                Optional callback invoked when the connection drops.
                Receives (close_code, connection_duration_seconds).
                """
            ),
        ] = None,
    ) -> None:
        self._ws: WebSocket = websocket
        self.ping_interval: int = max(1, ping_interval)
        self.pong_timeout: int = max(1, pong_timeout)
        self.on_disconnect: Optional[Callable[[int, float], Any]] = on_disconnect
        self._start_time: Optional[float] = None
        self._message_count: int = 0
        self._closed_code: int = 1000

    async def accept(self) -> None:
        """Accept the WebSocket connection and start tracking."""
        await self._ws.accept()
        self._start_time = _time.monotonic()

    async def run_heartbeat(self) -> None:
        """Start the heartbeat loop. Blocks until connection is closed."""
        if self._start_time is None:
            self._start_time = _time.monotonic()

        try:
            while True:
                await _asyncio.sleep(self.ping_interval)

                if self._ws.client_state == WebSocketState.DISCONNECTED:
                    break

                try:
                    await self._ws.send_json({"type": "ping"})
                except Exception:
                    break

                self._message_count += 1

                try:
                    pong = await _asyncio.wait_for(
                        self._ws.receive_text(),
                        timeout=self.pong_timeout,
                    )
                    self._message_count += 1
                except _asyncio.TimeoutError:
                    self._closed_code = 1001
                    await self._ws.close(code=1001)
                    break
                except Exception:
                    break
        finally:
            duration = _time.monotonic() - (self._start_time or _time.monotonic())
            if self.on_disconnect:
                self.on_disconnect(self._closed_code, duration)

    @property
    def connection_duration(self) -> float:
        """Duration of the current connection in seconds."""
        if self._start_time is None:
            return 0.0
        return _time.monotonic() - self._start_time

    @property
    def message_count(self) -> int:
        """Number of messages sent or received."""
        return self._message_count

    async def send_text(self, data: str) -> None:
        await self._ws.send_text(data)
        self._message_count += 1

    async def send_json(self, data: Any) -> None:
        await self._ws.send_json(data)
        self._message_count += 1

    async def send_bytes(self, data: bytes) -> None:
        await self._ws.send_bytes(data)
        self._message_count += 1

    async def receive_text(self) -> str:
        result = await self._ws.receive_text()
        self._message_count += 1
        return result

    async def receive_json(self, mode: str = "text") -> Any:
        result = await self._ws.receive_json(mode=mode)
        self._message_count += 1
        return result

    async def receive_bytes(self) -> bytes:
        result = await self._ws.receive_bytes()
        self._message_count += 1
        return result

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        self._closed_code = code
        await self._ws.close(code=code, reason=reason)
