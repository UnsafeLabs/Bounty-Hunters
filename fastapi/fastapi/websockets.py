import time
from collections.abc import Awaitable, Callable
from typing import Any, Optional

import anyio
from starlette.websockets import WebSocket as WebSocket  # noqa
from starlette.websockets import WebSocketDisconnect as WebSocketDisconnect  # noqa
from starlette.websockets import WebSocketState as WebSocketState  # noqa


class WebSocketWithHeartbeat(WebSocket):
    """
    A WebSocket wrapper that sends periodic ping frames to detect stale connections.

    Sends ping frames at a configurable interval and closes the connection if
    no pong is received within the timeout period. Tracks connection duration
    and message count.

    ## Example

    ```python
    from fastapi import FastAPI
    from fastapi.websockets import WebSocketWithHeartbeat

    app = FastAPI()

    @app.websocket("/ws")
    async def websocket_endpoint(ws: WebSocketWithHeartbeat):
        await ws.accept()
        try:
            while True:
                data = await ws.receive_text()
                await ws.send_text(f"Echo: {data}")
        except Exception:
            pass
    ```
    """

    def __init__(
        self,
        scope: Any,
        receive: Any,
        send: Any,
        *,
        ping_interval: float = 30.0,
        pong_timeout: float = 10.0,
        on_disconnect: Optional[Callable[[int, float], Awaitable[None]]] = None,
    ) -> None:
        super().__init__(scope, receive, send)
        self.ping_interval = ping_interval
        self.pong_timeout = pong_timeout
        self.on_disconnect = on_disconnect
        self._connect_time: Optional[float] = None
        self._message_count: int = 0
        self._task_group: Optional[anyio.abc.TaskGroup] = None
        self._last_pong_time: Optional[float] = None
        self._pong_event: anyio.Event = anyio.Event()

    @property
    def connection_duration(self) -> float:
        """Duration of the connection in seconds since accept()."""
        if self._connect_time is None:
            return 0.0
        return time.monotonic() - self._connect_time

    @property
    def message_count(self) -> int:
        """Number of messages received (excluding ping/pong control frames)."""
        return self._message_count

    async def accept(self, *args: Any, **kwargs: Any) -> None:
        """Accept the connection and start the heartbeat."""
        await super().accept(*args, **kwargs)
        self._connect_time = time.monotonic()
        self._last_pong_time = self._connect_time
        self._pong_event.set()
        self._task_group = anyio.create_task_group()
        await self._task_group.__aenter__()
        self._task_group.start_soon(self._heartbeat_loop)

    async def receive(self, *args: Any, **kwargs: Any) -> Any:
        """
        Receive a message, intercepting pong responses for heartbeat tracking.
        """
        message = await super().receive(*args, **kwargs)
        if message.get("type") == "websocket.pong":
            self._last_pong_time = time.monotonic()
            self._pong_event.set()
        else:
            self._message_count += 1
        return message

    async def receive_text(self) -> str:
        """Receive a text message."""
        self._message_count += 1
        return await super().receive_text()

    async def receive_bytes(self) -> bytes:
        """Receive a bytes message."""
        self._message_count += 1
        return await super().receive_bytes()

    async def receive_json(self, mode: str = "text") -> Any:
        """Receive a JSON message."""
        self._message_count += 1
        return await super().receive_json(mode=mode)

    async def close(self, code: int = 1000, reason: Optional[str] = None) -> None:
        """Close the connection and cancel the heartbeat."""
        if self._task_group is not None:
            self._task_group.cancel_scope.cancel()
            try:
                await self._task_group.__aexit__(None, None, None)
            except Exception:
                pass
            self._task_group = None
        await super().close(code=code, reason=reason)

    async def _heartbeat_loop(self) -> None:
        """Background task that sends pings and monitors pong responses."""
        try:
            while True:
                await anyio.sleep(self.ping_interval)

                # Reset pong event before sending ping
                self._pong_event = anyio.Event()

                # Send a ping frame
                try:
                    await super().send({"type": "websocket.ping"})
                except Exception:
                    break

                # Wait for pong with timeout
                with anyio.move_on_after(self.pong_timeout):
                    await self._pong_event.wait()

                # Check if pong was received
                if not self._pong_event.is_set():
                    # No pong received — close the connection
                    await self._close_with_callback(1001, "Pong timeout")
                    return

        except anyio.get_cancelled_exc_class():
            raise  # Let cancellation propagate
        except anyio.ClosedResourceError:
            pass
        except Exception:
            pass

    async def _close_with_callback(self, code: int, reason: str) -> None:
        """Close the connection and invoke the on_disconnect callback."""
        try:
            await super().close(code=code, reason=reason)
        except Exception:
            pass

        if self.on_disconnect is not None:
            try:
                await self.on_disconnect(code, self.connection_duration)
            except Exception:
                pass
