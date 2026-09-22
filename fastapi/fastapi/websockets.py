from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from typing import Any

from starlette.types import Message, Receive, Scope, Send
from starlette.websockets import WebSocket as StarletteWebSocket
from starlette.websockets import WebSocketDisconnect as WebSocketDisconnect
from starlette.websockets import WebSocketState as WebSocketState


class WebSocketWithHeartbeat:
    def __init__(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
        ping_interval: float = 30.0,
        pong_timeout: float = 10.0,
        on_disconnect: Callable[[int, float], Any] | None = None,
    ) -> None:
        self._websocket = StarletteWebSocket(scope, receive, send)
        self._ping_interval = ping_interval
        self._pong_timeout = pong_timeout
        self._on_disconnect = on_disconnect
        self._message_count = 0
        self._start_time = time.monotonic()
        self._last_pong_time = time.monotonic()
        self._heartbeat_task: asyncio.Task[None] | None = None
        self._receive_task: asyncio.Task[None] | None = None
        self._pong_received = asyncio.Event()
        self._closed = False
        self._close_code = 1000
        self._close_reason = ""
        self._message_queue: asyncio.Queue[Message] = asyncio.Queue()

    @property
    def ping_interval(self) -> float:
        return self._ping_interval

    @property
    def pong_timeout(self) -> float:
        return self._pong_timeout

    @property
    def connection_duration(self) -> float:
        return time.monotonic() - self._start_time

    @property
    def message_count(self) -> int:
        return self._message_count

    @property
    def client_state(self) -> WebSocketState:
        return self._websocket.client_state

    @property
    def application_state(self) -> WebSocketState:
        return self._websocket.application_state

    @property
    def scope(self) -> Scope:
        return self._websocket.scope

    @property
    def url(self) -> Any:
        return self._websocket.url

    @property
    def headers(self) -> Any:
        return self._websocket.headers

    @property
    def query_params(self) -> Any:
        return self._websocket.query_params

    @property
    def path_params(self) -> Any:
        return self._websocket.path_params

    @property
    def cookies(self) -> Any:
        return self._websocket.cookies

    @property
    def client(self) -> Any:
        return self._websocket.client

    @property
    def state(self) -> Any:
        return self._websocket.state

    async def accept(
        self,
        subprotocol: str | None = None,
        headers: list[tuple[bytes, bytes]] | None = None,
    ) -> None:
        await self._websocket.accept(subprotocol, headers)
        self._start_time = time.monotonic()
        self._last_pong_time = time.monotonic()
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())
        self._receive_task = asyncio.create_task(self._receive_loop())

    async def _heartbeat_loop(self) -> None:
        try:
            while not self._closed:
                await asyncio.sleep(self._ping_interval)
                if self._closed:
                    break
                if self._websocket.application_state != WebSocketState.CONNECTED:
                    break
                await self._send_ping()
                self._pong_received.clear()
                try:
                    await asyncio.wait_for(self._pong_received.wait(), timeout=self._pong_timeout)
                except asyncio.TimeoutError:
                    await self.close(code=1001, reason="Pong timeout")
                    break
        except asyncio.CancelledError:
            pass
        except Exception:
            pass

    async def _receive_loop(self) -> None:
        try:
            while not self._closed:
                message = await self._websocket.receive()
                if message["type"] == "websocket.disconnect":
                    self._closed = True
                    self._close_code = message.get("code", 1000)
                    self._close_reason = message.get("reason", "")
                    await self._message_queue.put(message)
                    if self._heartbeat_task:
                        self._heartbeat_task.cancel()
                    break
                elif message["type"] == "websocket.pong":
                    self._last_pong_time = time.monotonic()
                    self._pong_received.set()
                else:
                    await self._message_queue.put(message)
        except asyncio.CancelledError:
            pass
        except WebSocketDisconnect:
            self._closed = True
        except Exception:
            self._closed = True

    async def _send_ping(self) -> None:
        if self._websocket.application_state == WebSocketState.CONNECTED:
            await self._websocket.send({"type": "websocket.ping", "data": b""})

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        if self._closed:
            return
        self._closed = True
        self._close_code = code
        self._close_reason = reason or ""
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
        if self._receive_task:
            self._receive_task.cancel()
        try:
            await self._websocket.close(code, reason)
        except Exception:
            pass
        finally:
            if self._on_disconnect:
                try:
                    if asyncio.iscoroutinefunction(self._on_disconnect):
                        await self._on_disconnect(code, self.connection_duration)
                    else:
                        self._on_disconnect(code, self.connection_duration)
                except Exception:
                    pass

    async def receive(self) -> Message:
        if self._receive_task is None:
            raise RuntimeError("WebSocket not accepted. Call accept() first.")
        message = await self._message_queue.get()
        if message["type"] == "websocket.receive":
            self._message_count += 1
        return message

    async def receive_text(self) -> str:
        message = await self.receive()
        if message["type"] == "websocket.disconnect":
            raise WebSocketDisconnect(message["code"], message.get("reason"))
        return message["text"]

    async def receive_bytes(self) -> bytes:
        message = await self.receive()
        if message["type"] == "websocket.disconnect":
            raise WebSocketDisconnect(message["code"], message.get("reason"))
        return message["bytes"]

    async def receive_json(self, mode: str = "text") -> Any:
        if mode not in {"text", "binary"}:
            raise RuntimeError('The "mode" argument should be "text" or "binary".')
        message = await self.receive()
        if message["type"] == "websocket.disconnect":
            raise WebSocketDisconnect(message["code"], message.get("reason"))
        if mode == "text":
            text = message["text"]
        else:
            text = message["bytes"].decode("utf-8")
        import json
        return json.loads(text)

    async def send_text(self, data: str) -> None:
        await self._websocket.send({"type": "websocket.send", "text": data})

    async def send_bytes(self, data: bytes) -> None:
        await self._websocket.send({"type": "websocket.send", "bytes": data})

    async def send_json(self, data: Any, mode: str = "text") -> None:
        if mode not in {"text", "binary"}:
            raise RuntimeError('The "mode" argument should be "text" or "binary".')
        import json
        text = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
        if mode == "text":
            await self._websocket.send({"type": "websocket.send", "text": text})
        else:
            await self._websocket.send({"type": "websocket.send", "bytes": text.encode("utf-8")})

    async def iter_text(self) -> Any:
        try:
            while True:
                yield await self.receive_text()
        except WebSocketDisconnect:
            pass

    async def iter_bytes(self) -> Any:
        try:
            while True:
                yield await self.receive_bytes()
        except WebSocketDisconnect:
            pass

    async def iter_json(self) -> Any:
        try:
            while True:
                yield await self.receive_json()
        except WebSocketDisconnect:
            pass


__all__ = [
    "WebSocket",
    "WebSocketDisconnect",
    "WebSocketState",
    "WebSocketWithHeartbeat",
]

WebSocket = StarletteWebSocket
