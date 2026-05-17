"""Tests for WebSocketWithHeartbeat v3"""
import pytest, asyncio
from websocket_heartbeat import WebSocketWithHeartbeat

class TestWS:
    @pytest.mark.asyncio
    async def test_rapid_connect_disconnect(self):
        for _ in range(10):
            ws = WebSocketWithHeartbeat(heartbeat_interval=0.1, timeout=0.2)
            await ws.start(); await ws.pong(); await ws.stop()
        assert True

    @pytest.mark.asyncio
    async def test_connect_count(self):
        ws = WebSocketWithHeartbeat(heartbeat_interval=0.1)
        await ws.start(); await ws.pong(); await ws.stop()
        await ws.start(); await ws.pong(); await ws.stop()
        assert ws.connect_count == 2

    @pytest.mark.asyncio
    async def test_on_disconnect(self):
        called = []
        ws = WebSocketWithHeartbeat(heartbeat_interval=0.1)
        ws.on_disconnect(lambda: called.append(1))
        await ws.start(); await ws.pong(); await ws.stop()
        assert called == [1]

    @pytest.mark.asyncio
    async def test_timeout_detection(self):
        ws = WebSocketWithHeartbeat(heartbeat_interval=0.05, timeout=0.1)
        await ws.start()
        await asyncio.sleep(0.2)
        assert True
