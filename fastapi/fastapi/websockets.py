import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Any

from starlette.websockets import WebSocket as WebSocket  # noqa
from starlette.websockets import WebSocketDisconnect as WebSocketDisconnect  # noqa
from starlette.websockets import WebSocketState as WebSocketState  # noqa
from starlette.websockets import WebSocket as _StarletteWebSocket


class WebSocketWithHeartbeat(_StarletteWebSocket):
    """WebSocket wrapper with built-in heartbeat/ping mechanism.

    Sends ping frames at a configurable interval and closes the connection
    if no pong is received within the timeout period.

    Tracks connection duration and message count as properties.
    """

    def __init__(
        self,
        websocket: _StarletteWebSocket,
        *,
        ping_interval: int = 30,
        pong_timeout: int = 10,
        on_disconnect: Callable[[int, float], Awaitable[None] | None] | None = None,
    ) -> None:
        self._ws = websocket
        self.ping_interval = ping_interval
        self.pong_timeout = pong_timeout
        self._on_disconnect = on_disconnect

        self._start_time = time.monotonic()
        self._message_count = 0
        self._heartbeat_task: asyncio.Task[Any] | None = None
        self._stop_event = asyncio.Event()

    @property
    def connection_duration(self) -> float:
        """Elapsed seconds since connection was established."""
        return time.monotonic() - self._start_time

    @property
    def message_count(self) -> int:
        """Number of messages received on this connection."""
        return self._message_count

    async def start_heartbeat(self) -> None:
        """Begin periodic ping/pong health checks."""
        if self._heartbeat_task is not None:
            return
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())  # type: ignore[arg-type]

    async def stop_heartbeat(self) -> None:
        """Stop the heartbeat task."""
        if self._heartbeat_task is None:
            return
        self._stop_event.set()
        self._heartbeat_task.cancel()
        try:
            await self._heartbeat_task
        except asyncio.CancelledError:
            pass
        self._heartbeat_task = None

    async def _heartbeat_loop(self) -> None:
        """Internal loop: send ping, wait for pong, repeat until stopped."""
        while not self._stop_event.is_set():
            try:
                await asyncio.wait_for(
                    self._stop_event.wait(), timeout=self.ping_interval
                )
                break  # stop event set
            except asyncio.TimeoutError:
                pass  # time to send ping

            if self._stop_event.is_set():
                break

            try:
                # Send ping
                await self._ws.send_json({"type": "ping"})
            except Exception:
                break  # connection already gone

            # Wait for pong (any message counts as pong in practice)
            try:
                await asyncio.wait_for(self._receive_raw(), timeout=self.pong_timeout)
            except asyncio.TimeoutError:
                # No pong received — close connection
                close_code = 1001  # Going Away
                try:
                    await self._ws.close(code=close_code)
                except Exception:
                    pass
                if self._on_disconnect is not None:
                    result = self._on_disconnect(close_code, self.connection_duration)
                    if isinstance(result, Awaitable):
                        await result
                break
            except WebSocketDisconnect as e:
                close_code = e.code if hasattr(e, "code") and e.code else 1001
                if self._on_disconnect is not None:
                    result = self._on_disconnect(int(close_code), self.connection_duration)
                    if isinstance(result, Awaitable):
                        await result
                break
            except Exception:
                break

    async def _receive_raw(self) -> dict[str, Any]:
        """Receive a message and optionally track it."""
        message = await self._ws.receive_json()
        self._message_count += 1
        return message

    # Proxy methods to underlying WebSocket

    async def accept(
        self,
        subprotocol: str | None = None,
        headers: Any = None,
    ) -> None:
        await self._ws.accept(subprotocol=subprotocol, headers=headers)
        await self.start_heartbeat()

    async def receive_text(self) -> str:
        data = await self._ws.receive_text()
        self._message_count += 1
        return data

    async def receive_bytes(self) -> bytes:
        data = await self._ws.receive_bytes()
        self._message_count += 1
        return data

    async def receive_json(self, mode: str = "text") -> Any:
        data = await self._ws.receive_json(mode=mode)
        self._message_count += 1
        return data

    async def send_text(self, data: str) -> None:
        await self._ws.send_text(data)

    async def send_bytes(self, data: bytes) -> None:
        await self._ws.send_bytes(data)

    async def send_json(self, data: Any, mode: str = "text") -> None:
        await self._ws.send_json(data, mode=mode)

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        await self.stop_heartbeat()
        await self._ws.close(code=code, reason=reason)
        if self._on_disconnect is not None:
            result = self._on_disconnect(code, self.connection_duration)
            if isinstance(result, Awaitable):
                await result

    @property
    def client(self) -> Any:
        return self._ws.client

    @property
    def application_state(self) -> Any:
        return self._ws.application_state

    @property
    def state(self) -> Any:
        return self._ws.state

    @property
    def url(self) -> Any:
        return self._ws.url

    @property
    def base_url(self) -> Any:
        return self._ws.base_url

    @property
    def headers(self) -> Any:
        return self._ws.headers

    @property
    def query_params(self) -> Any:
        return self._ws.query_params

    @property
    def path_params(self) -> Any:
        return self._ws.path_params

    @property
    def cookies(self) -> Any:
        return self._ws.cookies

    @property
    def session(self) -> Any:
        return self._ws.session

    @property
    def scope(self) -> Any:
        return self._ws.scope
