"""Tests for WebSocketHeartbeat v2"""
import pytest, asyncio
from websocket_heartbeat import WebSocketWithHeartbeat
class MockWS:
    def __init__(self): self.pings = 0
    async def ping(self): self.pings += 1
class TestWSV2:
    @pytest.mark.asyncio
    async def test_rapid_cycles(self):
        for _ in range(10):
            ws = WebSocketWithHeartbeat(MockWS(), ping_interval=0.01)
            await ws.start(); await asyncio.sleep(0.02); await ws.stop()
            assert ws.connect_count == 1
    @pytest.mark.asyncio
    async def test_connect_count(self):
        ws = WebSocketWithHeartbeat(MockWS(), ping_interval=0.05)
        await ws.start(); await ws.stop(); await ws.start(); await ws.stop()
        assert ws.connect_count == 2
    @pytest.mark.asyncio
    async def test_on_disconnect(self):
        called = [False]
        async def cb(): called[0] = True
        ws = WebSocketWithHeartbeat(MockWS(), ping_interval=0.05, on_disconnect=cb)
        await ws.start(); await ws.stop(); assert called[0]
