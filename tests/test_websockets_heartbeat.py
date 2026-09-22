import asyncio

import pytest

from fastapi.fastapi.websockets import WebSocketWithHeartbeat


class FakeWebSocket:
    def __init__(self, pong=True):
        self.pong = pong
        self.pings = 0
        self.closed = []
        self.messages = ["a", "b"]

    async def send_ping(self):
        self.pings += 1

    async def wait_pong(self, timeout):
        await asyncio.sleep(0)
        return self.pong

    async def receive_text(self):
        return self.messages.pop(0)

    async def close(self, **kwargs):
        self.closed.append(kwargs)


@pytest.mark.asyncio
async def test_heartbeat_pings_and_counts_messages():
    ws = FakeWebSocket()
    wrapped = WebSocketWithHeartbeat(ws, ping_interval=0.01, pong_timeout=0.01)
    await wrapped.start()
    assert await wrapped.receive_text() == "a"
    await asyncio.sleep(0.025)
    await wrapped.stop()
    assert ws.pings >= 1
    assert wrapped.message_count == 1
    assert wrapped.connection_duration >= 0


@pytest.mark.asyncio
async def test_pong_timeout_closes_with_1001_and_calls_callback():
    ws = FakeWebSocket(pong=False)
    disconnected = []
    wrapped = WebSocketWithHeartbeat(
        ws, ping_interval=0.001, pong_timeout=0.001,
        on_disconnect=lambda code, duration: disconnected.append((code, duration)),
    )
    await wrapped.start()
    await asyncio.sleep(0.02)
    assert ws.closed == [{"code": 1001}]
    assert disconnected and disconnected[0][0] == 1001


def test_invalid_intervals_rejected():
    with pytest.raises(ValueError):
        WebSocketWithHeartbeat(FakeWebSocket(), ping_interval=0)
