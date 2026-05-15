import asyncio
from typing import Any

from starlette.websockets import WebSocket as StarletteWebSocket
from starlette.websockets import WebSocketDisconnect as WebSocketDisconnect
from starlette.websockets import WebSocketState as WebSocketState


class WebSocket(StarletteWebSocket):
    """
    FastAPI WebSocket with built-in heartbeat/ping-pong support.

    Extends Starlette's WebSocket to periodically send ping frames
    and close the connection if the client does not respond with
    pong frames.

    The heartbeat starts automatically after the connection is
    accepted via :meth:`accept`.

    Pong responses from the client are consumed transparently and
    are never returned to the application code.

    Args:
        scope: ASGI scope dictionary.
        receive: ASGI receive callable.
        send: ASGI send callable.
        heartbeat_interval: Interval in seconds between consecutive
            ping frames. Set to ``0`` or a negative value to disable
            the heartbeat entirely. Defaults to ``25``.
        heartbeat_max_misses: Maximum number of consecutive pings
            without a matching pong response before the connection
            is forcefully closed. Defaults to ``3``.
    """

    def __init__(
        self,
        scope: Any,
        receive: Any,
        send: Any,
        heartbeat_interval: int = 25,
        heartbeat_max_misses: int = 3,
    ) -> None:
        # Wrap the ASGI receive callable to intercept pong frames
        # before they reach Starlette's state machine (which does
        # not recognise ``websocket.pong`` and would raise).
        original_receive = receive

        async def _receive_with_pong_handling() -> dict[str, Any]:
            while True:
                msg = await original_receive()
                if msg.get("type") == "websocket.pong":
                    continue  # swallow the pong
                return msg

        super().__init__(scope, _receive_with_pong_handling, send)

        self._heartbeat_interval = heartbeat_interval
        self._heartbeat_max_misses = heartbeat_max_misses
        self._heartbeat_misses: int = 0
        self._heartbeat_task: asyncio.Task[None] | None = None

    # -- public helpers ---------------------------------------------------

    @property
    def heartbeat_misses(self) -> int:
        """Number of consecutive pings without a matching pong (read-only)."""
        return self._heartbeat_misses

    # -- overrides --------------------------------------------------------

    async def accept(
        self,
        subprotocol: str | None = None,
        headers: list[tuple[bytes, bytes]] | None = None,
    ) -> None:
        """Accept the WebSocket connection and start the heartbeat loop."""
        await super().accept(subprotocol, headers)
        self._start_heartbeat()

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        """Close the connection and cancel the heartbeat task if running."""
        self._cancel_heartbeat()
        await super().close(code, reason)

    # -- internal heartbeat machinery -------------------------------------

    def _start_heartbeat(self) -> None:
        """Begin the background ping loop if heartbeat is enabled."""
        if self._heartbeat_interval > 0 and self._heartbeat_task is None:
            self._heartbeat_task = asyncio.create_task(self._heartbeat_runner())

    def _cancel_heartbeat(self) -> None:
        """Stop the background ping loop."""
        if self._heartbeat_task is not None:
            self._heartbeat_task.cancel()
            self._heartbeat_task = None

    async def _heartbeat_runner(self) -> None:
        """Background coroutine that sends ``websocket.ping`` at intervals."""
        try:
            while True:
                await asyncio.sleep(self._heartbeat_interval)

                # If the connection is already gone, stop.
                if self.client_state == WebSocketState.DISCONNECTED:
                    break
                if self.application_state == WebSocketState.DISCONNECTED:
                    break

                # Send a ping frame through the raw ASGI send channel
                # (Starlette's ``send()`` does not allow ``websocket.ping``).
                try:
                    await self._send({"type": "websocket.ping"})
                except Exception:
                    break  # connection vanished

                self._heartbeat_misses += 1

                if self._heartbeat_misses >= self._heartbeat_max_misses:
                    # No response after N pings -- close the connection.
                    try:
                        await self.close(code=1000, reason="Heartbeat timeout")
                    except Exception:
                        pass
                    break
        except asyncio.CancelledError:
            pass
