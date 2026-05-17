"""Tests for SSEManager v3"""
import pytest, asyncio
from sse_manager import SSEManager

class TestSSEMgr:
    @pytest.mark.asyncio
    async def test_connect_disconnect(self):
        mgr = SSEManager()
        c = await mgr.connect("c1")
        assert "c1" in await mgr.get_connections()
        await mgr.disconnect("c1")
        assert "c1" not in await mgr.get_connections()

    @pytest.mark.asyncio
    async def test_broadcast_with_retry(self):
        mgr = SSEManager()
        c = await mgr.connect("c1")
        await mgr.broadcast("hello", retry=3000)
        event = await asyncio.wait_for(c.queue.get(), timeout=1)
        assert event["data"] == "hello"
        assert event["retry"] == 3000

    @pytest.mark.asyncio
    async def test_last_event_id(self):
        mgr = SSEManager()
        await mgr.broadcast("m1"); await mgr.broadcast("m2"); await mgr.broadcast("m3")
        c = await mgr.connect("c1", last_event_id=mgr._event_log[0]["id"])
        evts = []
        while not c.queue.empty(): evts.append(await c.queue.get())
        assert len(evts) >= 2

    @pytest.mark.asyncio
    async def test_cleanup_stale(self):
        mgr = SSEManager(max_age=0)
        await mgr.connect("c1")
        assert await mgr.cleanup_stale() == 1
        assert await mgr.get_connections() == []
