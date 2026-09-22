"""
WebSocket utilities for FastAPI.

This module extends the default Starlette WebSocket with a heartbeat
implementation that periodically sends ping frames and closes the
connection if a pong is not received within a configurable timeout.

The original FastAPI WebSocket handling remains unchanged; the new
`WebSocketWithHeartbeat` class can be used as a drop‑in wrapper.
"""

import asyncio
import time
from typing import Awaitable, Callable, Optional

from starlette.websockets import WebSocket, WebSocketDisconnect, WebSocketState


class WebSocketWithHeartbeat:
    """
    Wrap a Starlette ``WebSocket`` and add a configurable heartbeat.

    Parameters
    ----------
    websocket: WebSocket
        The underlying Starlette WebSocket instance (already accepted).
    ping_interval: float, optional
        Seconds between ping frames. Default is 30 seconds.
    pong_timeout: float, optional
        Seconds to wait for a pong after a ping. Default is 10 seconds.
    on_disconnect: Callable[[int, float], None], optional
        Callback invoked when the connection is closed due to a heartbeat
        failure. Receives the close code and the connection duration in
        seconds.
    """

    def __init__(
        self,
        websocket: WebSocket,
        *,
        ping_interval: float = 30.0,
        pong_timeout: float = 10.0,
        on_disconnect: Optional[Callable[[int, float], None]] = None,
    ) -> None:
        if websocket.application_state != WebSocketState.CONNECTED:
            raise RuntimeError("WebSocket must be accepted before wrapping with heartbeat.")
        self.websocket: WebSocket = websocket
        self.ping_interval: float = ping_interval
        self.pong_timeout: float = pong_timeout
        self.on_disconnect: Optional[Callable[[int, float], None]] = on_disconnect

        self._start_time: float = time.monotonic()
        self.message_count: int = 0

        self._ping_task: Optional[asyncio.Task[None]] = None
        self._closed: bool = False
        self._start_heartbeat()

    # --------------------------------------------------------------------- #
    # Public properties
    # --------------------------------------------------------------------- #
    @property
    def connection_duration(self) -> float:
        """Return the elapsed time (in seconds) since the connection was accepted."""
        return time.monotonic() - self._start_time

    # --------------------------------------------------------------------- #
    # Heartbeat implementation
    # --------------------------------------------------------------------- #
    def _start_heartbeat(self) -> None:
        """Create the background task that drives the ping/pong cycle."""
        self._ping_task = asyncio.create_task(self._ping_loop())

    async def _ping_loop(self) -> None:
        """Continuously send ping frames and enforce pong timeouts."""
        try:
            while not self._closed:
                await asyncio.sleep(self.ping_interval)
                if self._closed:
                    break
                # Send a ping frame
                await self.websocket.send_ping()
                try:
                    # Wait for the corresponding pong
                    await asyncio.wait_for(self._wait_for_pong(), timeout=self.pong_timeout)
                except asyncio.TimeoutError:
                    # No pong received – close the connection
                    await self._close_due_to_heartbeat(1001)
                    break
        except asyncio.CancelledError:
            # Task cancelled during normal shutdown
            pass
        except Exception:
            # Unexpected error – ensure the connection is closed
            await self._close_due_to_heartbeat(1011)

    async def _wait_for_pong(self) -> None:
        """
        Wait until a ``websocket.pong`` message is received.

        This method consumes messages from the underlying websocket until a
        pong is observed. Other message types are re‑queued for normal
        processing via ``receive_*`` methods.
        """
        while True:
            message = await self.websocket.receive()
            msg_type = message.get("type")
            if msg_type == "websocket.pong":
                return
            # For any other message, we put it back into an internal queue
            # so that the regular receive_* methods can fetch it later.
            # Starlette's WebSocket does not expose a public queue, therefore
            # we store it on the instance and let the wrapper methods check
            # this buffer first.
            self._buffer_message(message)

    # --------------------------------------------------------------------- #
    # Message buffering (to avoid losing non‑pong messages while waiting)
    # --------------------------------------------------------------------- #
    def _buffer_message(self, message: dict) -> None:
        """Store a message that arrived while awaiting a pong."""
        if not hasattr(self, "_msg_buffer"):
            self._msg_buffer = []
        self._msg_buffer.append(message)

    async def _pop_buffered_message(self) -> Optional[dict]:
        """Retrieve the next buffered message, if any."""
        if hasattr(self, "_msg_buffer") and self._msg_buffer:
            return self._msg_buffer.pop(0)
        return None

    # --------------------------------------------------------------------- #
    # Wrapper methods – delegate to the underlying WebSocket
    # --------------------------------------------------------------------- #
    async def accept(self, subprotocol: Optional[str] = None) -> None:
        await self.websocket.accept(subprotocol=subprotocol)

    async def close(self, code: int = 1000, reason: str = "") -> None:
        await self._close_due_to_heartbeat(code, reason)

    async def _close_due_to_heartbeat(self, code: int, reason: str = "") -> None:
        """Close the websocket and invoke the disconnect callback."""
        if self._closed:
            return
        self._closed = True
        if self._ping_task:
            self._ping_task.cancel()
        await self.websocket.close(code=code, reason=reason)
        if self.on_disconnect:
            try:
                self.on_disconnect(code, self.connection_duration)
            except Exception:
                # Ensure that a faulty callback does not raise further
                pass

    async def receive(self) -> dict:
        """
        Receive a raw message from the client, taking buffered messages into account.
        """
        buffered = await self._pop_buffered_message()
        if buffered is not None:
            return buffered
        return await self.websocket.receive()

    async def receive_text(self) -> str:
        msg = await self.receive()
        if msg.get("type") != "websocket.receive":
            raise RuntimeError(f"Unexpected message type: {msg.get('type')}")
        self.message_count += 1
        return msg.get("text", "")

    async def receive_bytes(self) -> bytes:
        msg = await self.receive()
        if msg.get("type") != "websocket.receive":
            raise RuntimeError(f"Unexpected message type: {msg.get('type')}")
        self.message_count += 1
        return msg.get("bytes", b"")

    async def receive_json(self) -> dict:
        data = await self.receive_text()
        import json

        return json.loads(data)

    async def send_text(self, data: str) -> None:
        await self.websocket.send_text(data)

    async def send_bytes(self, data: bytes) -> None:
        await self.websocket.send_bytes(data)

    async def send_json(self, data: dict) -> None:
        import json

        await self.websocket.send_text(json.dumps(data))

    async def send_ping(self, data: bytes = b"") -> None:
        await self.websocket.send_ping(data)

    async def send_pong(self, data: bytes = b"") -> None:
        await self.websocket.send_pong(data)

    # --------------------------------------------------------------------- #
    # Context manager support (optional but convenient)
    # --------------------------------------------------------------------- #
    async def __aenter__(self) -> "WebSocketWithHeartbeat":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.close()
