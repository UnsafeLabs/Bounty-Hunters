import asyncio
import json

import pytest
from fastapi import WebSocket, WebSocketWithHeartbeat
from starlette.websockets import WebSocketDisconnect


class FakeWebSocket:
    def __init__(self, messages=None):
        self.messages = list(messages or [])
        self.sent = []
        self.closed = []

    async def receive(self):
        if self.messages:
            return self.messages.pop(0)
        await asyncio.sleep(10)

    async def send_bytes(self, data):
        self.sent.append(data)

    async def close(self, code=1000, reason=None):
        self.closed.append((code, reason))


def test_fastapi_websocket_export_is_unchanged():
    assert WebSocket.__name__ == "WebSocket"


def test_tracks_message_count_and_connection_duration():
    async def run():
        websocket = WebSocketWithHeartbeat(
            FakeWebSocket(
                [
                    {"type": "websocket.receive", "text": "hello"},
                    {"type": "websocket.receive", "bytes": json.dumps({"ok": True}).encode()},
                ]
            )
        )

        assert await websocket.receive_text() == "hello"
        assert await websocket.receive_json(mode="binary") == {"ok": True}
        assert websocket.message_count == 2
        assert websocket.connection_duration >= 0

    asyncio.run(run())


def test_disconnect_callback_receives_code_and_duration():
    async def run():
        calls = []
        websocket = WebSocketWithHeartbeat(
            FakeWebSocket([{"type": "websocket.disconnect", "code": 1000}]),
            on_disconnect=lambda code, duration: calls.append((code, duration)),
        )

        with pytest.raises(WebSocketDisconnect):
            await websocket.receive_text()

        assert len(calls) == 1
        assert calls[0][0] == 1000
        assert calls[0][1] >= 0

    asyncio.run(run())


def test_heartbeat_closes_when_pong_timeout_expires():
    async def run():
        pings = []
        disconnects = []
        fake = FakeWebSocket()

        async def ping_sender(websocket):
            pings.append(websocket.connection_duration)

        websocket = WebSocketWithHeartbeat(
            fake,
            ping_interval=0.01,
            pong_timeout=0.01,
            ping_sender=ping_sender,
            on_disconnect=lambda code, duration: disconnects.append((code, duration)),
        )

        websocket.start_heartbeat()
        await asyncio.sleep(0.05)

        assert len(pings) == 1
        assert fake.closed == [(1001, None)]
        assert len(disconnects) == 1
        assert disconnects[0][0] == 1001

    asyncio.run(run())


def test_heartbeat_interval_and_timeout_can_be_overridden():
    websocket = WebSocketWithHeartbeat(FakeWebSocket(), ping_interval=1.5, pong_timeout=0.5)

    assert websocket.ping_interval == 1.5
    assert websocket.pong_timeout == 0.5
