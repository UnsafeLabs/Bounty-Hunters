import asyncio

import pytest

from fastapi.websockets import WebSocket, WebSocketDisconnect, WebSocketWithHeartbeat


def test_existing_websocket_exports_still_work():
    assert WebSocket is not None
    assert WebSocketDisconnect is not None


class FakeWebSocket:
    def __init__(self):
        self.accepted = False
        self.sent = []
        self.closed = None
        self.incoming = asyncio.Queue()

    async def accept(self, *args, **kwargs):
        self.accepted = True

    async def send_text(self, text):
        self.sent.append(text)

    async def close(self, **kwargs):
        self.closed = kwargs

    async def receive_text(self):
        return await self.incoming.get()


@pytest.mark.anyio
async def test_heartbeat_sends_ping_and_closes_on_timeout():
    websocket = FakeWebSocket()
    wrapper = WebSocketWithHeartbeat(websocket, ping_interval=0.01, pong_timeout=0.01)

    await wrapper.accept()
    await asyncio.sleep(0.04)

    assert "__ping__" in websocket.sent
    assert websocket.closed["code"] == 1001


@pytest.mark.anyio
async def test_on_disconnect_receives_close_code_and_duration():
    seen = []
    websocket = FakeWebSocket()
    wrapper = WebSocketWithHeartbeat(
        websocket,
        on_disconnect=lambda code, duration: seen.append((code, duration)),
    )

    await wrapper.close(code=1000)

    assert seen[0][0] == 1000
    assert seen[0][1] >= 0


@pytest.mark.anyio
async def test_receive_text_tracks_message_count_and_pong():
    websocket = FakeWebSocket()
    wrapper = WebSocketWithHeartbeat(websocket)

    await websocket.incoming.put("__pong__")
    assert await wrapper.receive_text() == "__pong__"

    assert wrapper.message_count == 1
    assert wrapper.connection_duration >= 0


def test_defaults_can_be_overridden_per_connection():
    wrapper = WebSocketWithHeartbeat(
        FakeWebSocket(),
        ping_interval=5,
        pong_timeout=2,
        close_code=1001,
    )

    assert wrapper.ping_interval == 5
    assert wrapper.pong_timeout == 2
    assert wrapper.close_code == 1001
