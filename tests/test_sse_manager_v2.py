"""Tests for SSEManager v2"""
import pytest, asyncio
from sse_manager import SSEManager
class TestSSEV2:
    @pytest.mark.asyncio
    async def test_concurrent_connect(self):
        mgr = SSEManager()
        async def cn(): return await mgr.connect()
        await asyncio.gather(*[cn() for _ in range(10)])
        assert await mgr.connection_count() == 10
    @pytest.mark.asyncio
    async def test_broadcast(self):
        mgr = SSEManager()
        await mgr.connect(); await mgr.connect()
        assert await mgr.broadcast("hi") == 2
    @pytest.mark.asyncio
    async def test_event_filter(self):
        mgr = SSEManager()
        await mgr.connect(["update"]); await mgr.connect(["alert"])
        assert len(await mgr.get_connections("update")) == 1
    @pytest.mark.asyncio
    async def test_cleanup_stale(self):
        mgr = SSEManager()
        await mgr.connect(); await asyncio.sleep(0.1)
        await mgr.cleanup_stale(max_age=0.05)
        assert await mgr.connection_count() == 0
