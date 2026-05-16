import asyncio
from typing import Any

import pytest
from fastapi import WebSocket
from fastapi import WebSocketWithHeartbeat as TopLevelWebSocketWithHeartbeat
from fastapi.websockets import (
    WebSocketDisconnect,
    WebSocketState,
    WebSocketWithHeartbeat,
)


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


class FakeWebSocket:
    def __init__(self) -> None:
        self.application_state = WebSocketState.CONNECTED
        self.accepted = False
        self.sent_bytes: list[bytes] = []
        self.close_calls: list[tuple[int, str | None]] = []
        self.messages: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

    async def accept(self, *args: Any, **kwargs: Any) -> None:
        self.accepted = True

    async def send_bytes(self, data: bytes) -> None:
        self.sent_bytes.append(data)

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        self.application_state = WebSocketState.DISCONNECTED
        self.close_calls.append((code, reason))

    async def receive(self) -> dict[str, Any]:
        return await self.messages.get()

    def _raise_on_disconnect(self, message: dict[str, Any]) -> None:
        if message["type"] == "websocket.disconnect":
            raise WebSocketDisconnect(code=message.get("code", 1000))


def test_existing_websocket_export_is_unchanged() -> None:
    assert WebSocket.__name__ == "WebSocket"
    assert TopLevelWebSocketWithHeartbeat is WebSocketWithHeartbeat


@pytest.mark.anyio
async def test_heartbeat_sends_ping_payload_at_configured_interval() -> None:
    websocket = FakeWebSocket()
    heartbeat = WebSocketWithHeartbeat(websocket, ping_interval=0.01, pong_timeout=1.0)

    await heartbeat.accept()
    await asyncio.sleep(0.03)
    await heartbeat.close()

    assert websocket.accepted is True
    assert websocket.sent_bytes
    assert websocket.sent_bytes[0] == b"ping"


@pytest.mark.anyio
async def test_heartbeat_closes_when_pong_timeout_is_exceeded() -> None:
    disconnects: list[tuple[int, float]] = []
    websocket = FakeWebSocket()
    heartbeat = WebSocketWithHeartbeat(
        websocket,
        ping_interval=0.01,
        pong_timeout=0.01,
        on_disconnect=lambda code, duration: disconnects.append((code, duration)),
    )

    await heartbeat.accept()
    await asyncio.sleep(0.05)

    assert websocket.close_calls == [(1001, None)]
    assert disconnects
    assert disconnects[0][0] == 1001
    assert disconnects[0][1] > 0


@pytest.mark.anyio
async def test_recorded_pong_keeps_connection_open_until_later_timeout() -> None:
    websocket = FakeWebSocket()
    heartbeat = WebSocketWithHeartbeat(websocket, ping_interval=0.01, pong_timeout=0.03)

    await heartbeat.accept()
    await asyncio.sleep(0.015)
    heartbeat.record_pong()
    await asyncio.sleep(0.02)

    assert websocket.close_calls == []

    await heartbeat.close()


@pytest.mark.anyio
async def test_receive_filters_pong_and_tracks_application_message_count() -> None:
    websocket = FakeWebSocket()
    heartbeat = WebSocketWithHeartbeat(websocket)
    await websocket.messages.put({"type": "websocket.receive", "bytes": b"pong"})
    await websocket.messages.put({"type": "websocket.receive", "text": "hello"})

    assert await heartbeat.receive_text() == "hello"
    assert heartbeat.message_count == 1


@pytest.mark.anyio
async def test_disconnect_callback_receives_close_code_and_duration() -> None:
    disconnects: list[tuple[int, float]] = []
    websocket = FakeWebSocket()
    heartbeat = WebSocketWithHeartbeat(
        websocket,
        on_disconnect=lambda code, duration: disconnects.append((code, duration)),
    )
    await websocket.messages.put({"type": "websocket.disconnect", "code": 1006})

    message = await heartbeat.receive()

    assert message["type"] == "websocket.disconnect"
    assert disconnects
    assert disconnects[0][0] == 1006
    assert disconnects[0][1] >= 0
