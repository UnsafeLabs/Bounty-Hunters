"""
WebSocket heartbeat management for connection keep-alive.
"""

from __future__ import annotations

import asyncio
import json
import typing

from starlette.websockets import WebSocket

if typing.TYPE_CHECKING:
    from collections.abc import AsyncIterator


class WebSocketHeartbeat:
    """
    Manages WebSocket heartbeat (ping/pong) for connection keep-alive.

    Automatically sends periodic ping messages and tracks last activity.
    Closes the connection if the client stops responding.

    .. code-block:: python

        from fastapi import FastAPI, WebSocket
        from fastapi.websockets import WebSocketHeartbeat

        app = FastAPI()

        @app.websocket("/ws")
        async def websocket_endpoint(websocket: WebSocket):
            await websocket.accept()

            heartbeat = WebSocketHeartbeat(
                websocket,
                interval=30,
                timeout=60,
                ping_message={"type": "ping"},
                pong_message={"type": "pong"},
            )

            async for message in heartbeat.listen():
                # Handle incoming messages while heartbeat runs
                await websocket.send_json({"echo": message})

    Args:
        websocket: The accepted WebSocket connection.
        interval: Seconds between ping messages (default: 30).
        timeout: Seconds of inactivity before closing (default: 60).
        ping_message: Message to send as ping (default: `{"type": "ping"}`).
        pong_message: Expected response for pong (default: `{"type": "pong"}`).
        close_code: WebSocket close code on timeout (default: 4000).
    """

    def __init__(
        self,
        websocket: WebSocket,
        *,
        interval: float = 30.0,
        timeout: float = 60.0,
        ping_message: dict[str, typing.Any] | str | None = None,
        pong_message: dict[str, typing.Any] | str | None = None,
        close_code: int = 4000,
    ) -> None:
        self.websocket = websocket
        self.interval = interval
        self.timeout = timeout
        self.ping_message = ping_message or {"type": "ping"}
        self.pong_message = pong_message or {"type": "pong"}
        self.close_code = close_code

        self._last_activity: float = 0.0
        self._running = False
        self._heartbeat_task: asyncio.Task | None = None
        self._lock = asyncio.Lock()

    async def _send_ping(self) -> None:
        """Send a ping message to the client."""
        try:
            if isinstance(self.ping_message, str):
                await self.websocket.send_text(self.ping_message)
            else:
                await self.websocket.send_json(self.ping_message)
        except Exception:
            self._running = False

    async def _check_timeout(self) -> bool:
        """Check if the connection has timed out. Returns True if timed out."""
        import time

        elapsed = time.monotonic() - self._last_activity
        return elapsed > self.timeout

    async def _heartbeat_loop(self) -> None:
        """Background task that sends periodic pings and monitors timeout."""
        import time

        while self._running:
            await asyncio.sleep(self.interval)

            if not self._running:
                break

            # Check for timeout
            if await self._check_timeout():
                self._running = False
                try:
                    await self.websocket.close(self.close_code)
                except Exception:
                    pass
                return

            # Send ping
            await self._send_ping()

    async def listen(self) -> AsyncIterator[dict[str, typing.Any] | str]:
        """
        Async iterator that yields incoming messages while heartbeat runs.

        Automatically tracks activity on each message received.
        Yields parsed JSON objects or raw text strings.
        """
        self._running = True
        self._last_activity = asyncio.get_event_loop().time()

        # Start heartbeat task
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

        try:
            while self._running:
                try:
                    # Use wait_for with a short timeout to allow checking _running
                    message = await asyncio.wait_for(
                        self.websocket.receive_text(),
                        timeout=min(self.interval, 5.0),
                    )
                    async with self._lock:
                        self._last_activity = asyncio.get_event_loop().time()

                    # Try to parse as JSON
                    try:
                        yield json.loads(message)
                    except (json.JSONDecodeError, TypeError):
                        yield message

                    # Check for pong response
                    if isinstance(self.pong_message, str):
                        if message == self.pong_message:
                            continue
                    elif isinstance(self.pong_message, dict):
                        try:
                            parsed = json.loads(message)
                            if parsed == self.pong_message:
                                continue
                        except (json.JSONDecodeError, TypeError):
                            pass

                except asyncio.TimeoutError:
                    # Periodic timeout check
                    if await self._check_timeout():
                        self._running = False
                        try:
                            await self.websocket.close(self.close_code)
                        except Exception:
                            pass
                        break
                except Exception:
                    # Connection closed or error
                    self._running = False
                    break
        finally:
            self._running = False
            if self._heartbeat_task and not self._heartbeat_task.done():
                self._heartbeat_task.cancel()
                try:
                    await self._heartbeat_task
                except asyncio.CancelledError:
                    pass

    async def close(self, code: int | None = None) -> None:
        """Close the heartbeat and the WebSocket connection."""
        self._running = False
        if self._heartbeat_task and not self._heartbeat_task.done():
            self._heartbeat_task.cancel()
            try:
                await self._heartbeat_task
            except asyncio.CancelledError:
                pass
        if code is not None:
            try:
                await self.websocket.close(code)
            except Exception:
                pass

    @property
    def is_alive(self) -> bool:
        """Whether the heartbeat is currently running."""
        return self._running

    @property
    def last_activity(self) -> float:
        """Unix timestamp of last activity."""
        return self._last_activity
