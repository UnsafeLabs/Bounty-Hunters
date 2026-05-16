"""Tests for SSEManager with concurrency safety"""
import pytest
import asyncio
from sse_manager import SSEManager

class TestSSEManagerV2:
    @pytest.mark.asyncio
    async def test_connect_and_count(self):
        mgr = SSEManager()
        cid = await mgr.connect()
        assert cid is not None
        assert await mgr.connection_count() == 1
        await mgr.disconnect(cid)
        assert await mgr.connection_count() == 0

    @pytest.mark.asyncio
    async def test_broadcast(self):
        mgr = SSEManager()
        c1 = await mgr.connect()
        c2 = await mgr.connect()
        sent = await mgr.broadcast("hello")
        assert sent == 2

    @pytest.mark.asyncio
    async def test_event_type_filtering(self):
        mgr = SSEManager()
        c1 = await mgr.connect(event_types=["update"])
        c2 = await mgr.connect(event_types=["alert"])
        filtered = await mgr.get_connections(event_type="update")
        assert len(filtered) == 1

    @pytest.mark.asyncio
    async def test_concurrent_connect(self):
        mgr = SSEManager()
        async def connect_n(n): return [await mgr.connect() for _ in range(n)]
        ids = await asyncio.gather(connect_n(5), connect_n(5))
        assert await mgr.connection_count() == 10

    @pytest.mark.asyncio
    async def test_cleanup_stale(self):
        mgr = SSEManager()
        await mgr.connect()
        await asyncio.sleep(0.1)
        await mgr.cleanup_stale(max_age=0.05)
        assert await mgr.connection_count() == 0

    @pytest.mark.asyncio
    async def test_disconnect_nonexistent(self):
        mgr = SSEManager()
        await mgr.disconnect("nonexistent")
        assert await mgr.connection_count() == 0
