import asyncio
from typing import Any, cast

import pytest
from fastapi import FastAPI, WebSocket, WebSocketWithHeartbeat
from fastapi.testclient import TestClient
from fastapi.websockets import WebSocketDisconnect, WebSocketState


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


class FakeWebSocket:
    def __init__(self) -> None:
        self.application_state = WebSocketState.CONNECTING
        self.messages: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.sent_bytes: list[bytes] = []
        self.close_calls: list[tuple[int, str | None]] = []

    async def accept(
        self,
        subprotocol: str | None = None,
        headers: list[tuple[bytes, bytes]] | None = None,
    ) -> None:
        self.application_state = WebSocketState.CONNECTED

    async def receive(self) -> dict[str, Any]:
        return await self.messages.get()

    async def send_bytes(self, data: bytes) -> None:
        self.sent_bytes.append(data)

    async def close(self, code: int, reason: str | None = None) -> None:
        self.application_state = WebSocketState.DISCONNECTED
        self.close_calls.append((code, reason))


def make_heartbeat(**kwargs: Any) -> tuple[FakeWebSocket, WebSocketWithHeartbeat]:
    websocket = FakeWebSocket()
    heartbeat = WebSocketWithHeartbeat(cast(WebSocket, websocket), **kwargs)
    return websocket, heartbeat


def test_websocket_export_remains_unchanged() -> None:
    from starlette.websockets import WebSocket as StarletteWebSocket

    assert WebSocket is StarletteWebSocket


def test_plain_websocket_still_works() -> None:
    app = FastAPI()

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket) -> None:
        await websocket.accept()
        await websocket.send_text(await websocket.receive_text())
        await websocket.close()

    with TestClient(app).websocket_connect("/ws") as websocket:
        websocket.send_text("hello")
        assert websocket.receive_text() == "hello"


def test_heartbeat_defaults_and_overrides() -> None:
    _, heartbeat = make_heartbeat()
    assert heartbeat.ping_interval == 30.0
    assert heartbeat.pong_timeout == 10.0

    _, heartbeat = make_heartbeat(ping_interval=5.0, pong_timeout=2.0)
    assert heartbeat.ping_interval == 5.0
    assert heartbeat.pong_timeout == 2.0


@pytest.mark.parametrize("name", ["ping_interval", "pong_timeout"])
def test_heartbeat_intervals_must_be_positive(name: str) -> None:
    with pytest.raises(ValueError, match=f"{name} must be greater than 0"):
        make_heartbeat(**{name: 0})


@pytest.mark.anyio
async def test_heartbeat_sends_ping_at_configured_interval_and_accepts_pong() -> None:
    websocket, heartbeat = make_heartbeat(ping_interval=0.01, pong_timeout=0.05)
    await heartbeat.accept()

    await asyncio.sleep(0.02)
    assert websocket.sent_bytes == [b"ping"]

    await websocket.messages.put({"type": "websocket.receive", "bytes": b"pong"})
    await websocket.messages.put({"type": "websocket.receive", "text": "payload"})
    assert await heartbeat.receive_text() == "payload"
    assert heartbeat.message_count == 1

    await asyncio.sleep(0.02)
    assert websocket.close_calls == []
    await heartbeat.close()


def test_heartbeat_messages_work_through_asgi() -> None:
    app = FastAPI()
    counts: list[int] = []

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket) -> None:
        heartbeat = WebSocketWithHeartbeat(
            websocket, ping_interval=0.01, pong_timeout=0.2
        )
        await heartbeat.accept()
        message = await heartbeat.receive_text()
        counts.append(heartbeat.message_count)
        await heartbeat.send_text(message)
        await heartbeat.close()

    with TestClient(app).websocket_connect("/ws") as websocket:
        assert websocket.receive_bytes() == b"ping"
        websocket.send_bytes(b"pong")
        websocket.send_text("hello")
        assert websocket.receive_text() == "hello"

    assert counts == [1]


@pytest.mark.anyio
async def test_pong_timeout_closes_with_1001_and_invokes_async_callback() -> None:
    disconnected: list[tuple[int, float]] = []

    async def on_disconnect(code: int, duration: float) -> None:
        await asyncio.sleep(0)
        disconnected.append((code, duration))

    websocket, heartbeat = make_heartbeat(
        ping_interval=0.01,
        pong_timeout=0.01,
        on_disconnect=on_disconnect,
    )
    await heartbeat.accept()
    await asyncio.sleep(0.04)

    assert websocket.sent_bytes == [b"ping"]
    assert websocket.close_calls == [(1001, "Pong timeout")]
    assert len(disconnected) == 1
    assert disconnected[0][0] == 1001
    assert disconnected[0][1] > 0

    duration = heartbeat.connection_duration
    await asyncio.sleep(0.01)
    assert heartbeat.connection_duration == duration


@pytest.mark.anyio
async def test_remote_disconnect_invokes_sync_callback_once() -> None:
    disconnected: list[tuple[int, float]] = []
    websocket, heartbeat = make_heartbeat(
        ping_interval=1,
        on_disconnect=lambda code, duration: disconnected.append((code, duration)),
    )
    await heartbeat.accept()
    await websocket.messages.put(
        {"type": "websocket.disconnect", "code": 1006, "reason": "lost"}
    )

    with pytest.raises(WebSocketDisconnect) as exc_info:
        await heartbeat.receive_text()

    assert exc_info.value.code == 1006
    assert len(disconnected) == 1
    assert disconnected[0][0] == 1006
    assert disconnected[0][1] >= 0
    await heartbeat.close()
    assert len(disconnected) == 1


@pytest.mark.anyio
async def test_message_count_tracks_all_non_heartbeat_receive_methods() -> None:
    websocket, heartbeat = make_heartbeat(ping_interval=1)
    await heartbeat.accept()
    await websocket.messages.put({"type": "websocket.receive", "text": "one"})
    await websocket.messages.put({"type": "websocket.receive", "bytes": b"two"})
    await websocket.messages.put({"type": "websocket.receive", "text": '{"value": 3}'})

    assert await heartbeat.receive_text() == "one"
    assert await heartbeat.receive_bytes() == b"two"
    assert await heartbeat.receive_json() == {"value": 3}
    assert heartbeat.message_count == 3
    await heartbeat.close()


@pytest.mark.anyio
async def test_connection_duration_starts_when_accepted() -> None:
    _, heartbeat = make_heartbeat(ping_interval=1)
    await asyncio.sleep(0.01)
    await heartbeat.accept()
    started_duration = heartbeat.connection_duration
    await asyncio.sleep(0.01)

    assert started_duration < 0.005
    assert heartbeat.connection_duration >= 0.01
    await heartbeat.close()
