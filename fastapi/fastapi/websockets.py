import asyncio
import time
from collections.abc import Awaitable, Callable

from starlette.websockets import WebSocket as WebSocket  # noqa
from starlette.websockets import WebSocketDisconnect as WebSocketDisconnect  # noqa
from starlette.websockets import WebSocketState as WebSocketState  # noqa


class WebSocketWithHeartbeat:
    """WebSocket wrapper with configurable ping/pong heartbeat.

    Parameters:
        websocket: The underlying Starlette WebSocket connection.
        ping_interval: Seconds between ping frames (default 30).
        pong_timeout: Seconds to wait for pong before disconnecting (default 10).
        on_disconnect: Optional callback invoked on drop: (close_code, duration_seconds).
    """

    def __init__(
        self,
        websocket: WebSocket,
        *,
        ping_interval: float = 30.0,
        pong_timeout: float = 10.0,
        on_disconnect: Callable[[int, float], None | Awaitable[None]] | None = None,
    ) -> None:
        self._ws = websocket
        self._ping_interval = ping_interval
        self._pong_timeout = pong_timeout
        self._on_disconnect = on_disconnect

        self._message_count: int = 0
        self._connection_start: float | None = None
        self._heartbeat_task: asyncio.Task | None = None
        self._closed: bool = False

    @property
    def connection_duration(self) -> float:
        """Elapsed seconds since the connection was established."""
        if self._connection_start is None:
            return 0.0
        return time.monotonic() - self._connection_start

    @property
    def message_count(self) -> int:
        """Number of messages received on this connection."""
        return self._message_count

    async def _heartbeat_loop(self) -> None:
        """Periodically send ping frames and wait for pong."""
        try:
            while not self._closed:
                await asyncio.sleep(self._ping_interval)
                if self._closed:
                    break
                try:
                    await asyncio.wait_for(
                        self._ws.send_json({"type": "ping"}),
                        timeout=self._pong_timeout,
                    )
                except asyncio.TimeoutError:
                    await self._handle_disconnect(1001)
                    return
                except WebSocketDisconnect:
                    await self._handle_disconnect(1006)
                    return
        except asyncio.CancelledError:
            pass

    async def _handle_disconnect(self, code: int) -> None:
        self._closed = True
        duration = self.connection_duration
        if self._on_disconnect is not None:
            result = self._on_disconnect(code, duration)
            if asyncio.iscoroutine(result):
                await result

    async def accept(self) -> None:
        """Accept the WebSocket connection and start the heartbeat."""
        await self._ws.accept()
        self._connection_start = time.monotonic()
        if self._ping_interval > 0:
            self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

    async def receive(self):
        """Receive a text or binary message, tracking message count."""
        data = await self._ws.receive()
        self._message_count += 1
        return data

    async def send(self, data) -> None:
        """Send data through the underlying WebSocket."""
        await self._ws.send(data)

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        """Close the WebSocket connection."""
        self._closed = True
        if self._heartbeat_task is not None:
            self._heartbeat_task.cancel()
            try:
                await self._heartbeat_task
            except asyncio.CancelledError:
                pass
        await self._handle_disconnect(code)
        try:
            await self._ws.close(code, reason)
        except WebSocketDisconnect:
            pass

    # Delegate remaining attributes to the underlying WebSocket
    @property
    def client(self):
        return self._ws.client

    @property
    def application_state(self):
        return self._ws.application_state

    @property
    def state(self):
        return self._ws.state

    @property
    def url(self):
        return self._ws.url

    @property
    def base_url(self):
        return self._ws.base_url

    @property
    def headers(self):
        return self._ws.headers

    @property
    def query_params(self):
        return self._ws.query_params

    @property
    def path_params(self):
        return self._ws.path_params

    @property
    def cookies(self):
        return self._ws.cookies

    @property
    def client_state(self):
        return self._ws.client_state

    @property
    def extensions(self):
        return self._ws.extensions

    async def receive_text(self) -> str:
        data = await self._ws.receive_text()
        self._message_count += 1
        return data

    async def receive_bytes(self) -> bytes:
        data = await self._ws.receive_bytes()
        self._message_count += 1
        return data

    async def receive_json(self, mode: str = "text") -> dict | list:
        data = await self._ws.receive_json(mode)
        self._message_count += 1
        return data

    async def send_text(self, data: str) -> None:
        await self._ws.send_text(data)

    async def send_bytes(self, data: bytes) -> None:
        await self._ws.send_bytes(data)

    async def send_json(self, data: dict | list, mode: str = "text") -> None:
        await self._ws.send_json(data, mode)

    def __iter__(self) -> None:
        raise TypeError("WebSocketWithHeartbeat is not directly iterable")

    async def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return await self.receive()
        except WebSocketDisconnect:
            raise StopAsyncIteration
