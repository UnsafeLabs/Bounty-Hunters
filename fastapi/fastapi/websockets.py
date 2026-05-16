import asyncio
import time
from typing import Any, Callable, Coroutine

from starlette.websockets import WebSocket as WebSocket  # noqa
from starlette.websockets import WebSocketDisconnect as WebSocketDisconnect  # noqa
from starlette.websockets import WebSocketState as WebSocketState  # noqa


class WebSocketWithHeartbeat:
    """Wrapper around a WebSocket connection that adds ping/pong heartbeat.

    Sends ping frames at a configurable interval.  If no pong is received
    within the timeout, the connection is closed with code 1001.

    Args:
        websocket: The underlying Starlette WebSocket connection.
        ping_interval: Seconds between ping frames (default: 30).
        pong_timeout: Seconds to wait for a pong response before closing
            (default: 10).
        on_disconnect: Optional async callback that receives the close code
            and connection duration in seconds.
    """

    def __init__(
        self,
        websocket: WebSocket,
        ping_interval: float = 30.0,
        pong_timeout: float = 10.0,
        on_disconnect: (
            Callable[[int, float], Coroutine[Any, Any, None]] | None
        ) = None,
    ) -> None:
        self._ws = websocket
        self._ping_interval = ping_interval
        self._pong_timeout = pong_timeout
        self._on_disconnect = on_disconnect
        self._start_time = time.monotonic()
        self._message_count = 0
        self._last_pong = time.monotonic()
        self._running = True
        self._close_code: int | None = None

    @property
    def connection_duration(self) -> float:
        """Return the connection duration in seconds."""
        return time.monotonic() - self._start_time

    @property
    def message_count(self) -> int:
        """Return the total number of messages sent/received."""
        return self._message_count

    @property
    def close_code(self) -> int | None:
        """Return the close code if the connection was closed."""
        return self._close_code

    async def start_heartbeat(self) -> None:
        """Start the heartbeat loop. Runs until the connection is closed."""
        try:
            while self._running:
                await asyncio.sleep(self._ping_interval)

                if not self._running:
                    break

                # Send a ping frame directly via the underlying ASGI send
                # callable (Starlette's send() only allows websocket.send and
                # websocket.close in CONNECTED state).
                try:
                    await self._ws._send({"type": "websocket.ping"})
                except Exception:
                    self._running = False
                    break

                # Wait for pong
                waited = 0.0
                while waited < self._pong_timeout and self._running:
                    await asyncio.sleep(0.5)
                    waited += 0.5
                    since_pong = time.monotonic() - self._last_pong
                    if since_pong < 1.0:  # Pong was received
                        break
                else:
                    # Timeout - no pong received
                    self._close_code = 1001
                    try:
                        await self._ws.close(code=1001)
                    except Exception:
                        pass
                    self._running = False

                    if self._on_disconnect is not None:
                        await self._on_disconnect(
                            self._close_code, self.connection_duration
                        )
                    break

        except Exception:
            self._running = False
            raise

    async def receive(self) -> dict[str, Any]:
        """Receive a message and track message count.

        Uses the underlying ASGI ``_receive`` callable so that pong frames
        (``websocket.pong``) are not rejected by Starlette's state validation.
        """
        msg = await self._ws._receive()
        self._message_count += 1

        # Track pong responses
        if isinstance(msg, dict) and msg.get("type") == "websocket.pong":
            self._last_pong = time.monotonic()

        return msg

    async def send(self, data: dict[str, Any]) -> None:
        """Send a message and track message count."""
        await self._ws.send(data)
        self._message_count += 1

    async def receive_text(self) -> str:
        """Receive a text message."""
        self._message_count += 1
        return await self._ws.receive_text()

    async def receive_bytes(self) -> bytes:
        """Receive a bytes message."""
        self._message_count += 1
        return await self._ws.receive_bytes()

    async def receive_json(self, mode: str = "text") -> Any:
        """Receive a JSON message."""
        self._message_count += 1
        return await self._ws.receive_json(mode=mode)

    async def send_text(self, data: str) -> None:
        """Send a text message."""
        self._message_count += 1
        await self._ws.send_text(data)

    async def send_bytes(self, data: bytes) -> None:
        """Send a bytes message."""
        self._message_count += 1
        await self._ws.send_bytes(data)

    async def send_json(self, data: Any, mode: str = "text") -> None:
        """Send a JSON message."""
        self._message_count += 1
        await self._ws.send_json(data, mode=mode)

    async def close(self, code: int = 1000, reason: str = "") -> None:
        """Close the connection."""
        self._running = False
        self._close_code = code
        await self._ws.close(code=code, reason=reason)

    async def accept(self, subprotocol: str | None = None) -> None:
        """Accept the WebSocket connection."""
        await self._ws.accept(subprotocol=subprotocol)

    @property
    def client_state(self) -> Any:
        """Return the client state."""
        return self._ws.client_state

    @property
    def application_state(self) -> Any:
        """Return the application state."""
        return self._ws.application_state
