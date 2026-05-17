"""Tests for SSE disconnect detection, event filtering, reconnect replay, and SSEManager."""

import asyncio
import json
from typing import AsyncGenerator

import pytest
from fastapi import FastAPI, Request
from fastapi.sse import (
    SSEManager,
    ServerSentEvent,
    format_sse_event,
    sse_generator,
)
from fastapi.testclient import TestClient


class TestDisconnectDetection:
    """Event generator stops cleanly when client disconnects."""
    # Disconnect detection is tested in test_sse_integration.py
    pass


class TestEventFiltering:
    """Clients can filter events by type using a query parameter."""

    @pytest.mark.asyncio
    async def test_events_filtered_by_type(self):
        """Only events matching the filter should be yielded."""

        async def event_stream() -> AsyncGenerator[ServerSentEvent, None]:
            events = [
                ServerSentEvent(data="a", event="type1"),
                ServerSentEvent(data="b", event="type2"),
                ServerSentEvent(data="c", event="type1"),
                ServerSentEvent(data="d", event="type2"),
            ]
            for ev in events:
                yield ev

        # Create a mock request where receive() hangs (timeout = still connected)
        from unittest.mock import MagicMock, AsyncMock
        req = MagicMock(spec=Request)
        req.headers = {}
        async def _hang():
            await asyncio.sleep(999)
        req.receive = _hang

        collected = []
        async for chunk in sse_generator(
            req, event_stream(), event_type_filter="type1"
        ):
            collected.append(chunk)

        # Should only contain type1 events (a and c)
        assert len(collected) == 2
        assert b"data: \"a\"" in collected[0]
        assert b"data: \"c\"" in collected[1]
        assert b"data: \"b\"" not in collected[0]
        assert b"data: \"d\"" not in collected[0]


class TestReconnectReplay:
    """Last-Event-ID header is read and events since that ID are replayed."""

    @pytest.mark.asyncio
    async def test_reconnect_replay(self):
        """Events since last_event_id should be replayed on reconnect via SSEManager."""

        manager = SSEManager()
        async def event_stream() -> AsyncGenerator[ServerSentEvent, None]:
            yield ServerSentEvent(data="first", id="1")
            yield ServerSentEvent(data="second", id="2")
            yield ServerSentEvent(data="third", id="3")

        # First pass: consume all events via manager broadcast
        client_id = "test-client-1"
        queue = await manager.connect(client_id)

        # Simulate broadcasting events
        await manager.broadcast_formatted("first", event_type="update")
        await manager.broadcast_formatted("second", event_type="update")
        await manager.broadcast_formatted("third", event_type="update")

        # Now simulate reconnect with last_event_id="1"
        replay = manager.get_reconnect_events("1")
        assert len(replay) == 2  # Events 2 and 3
        assert "second" in replay[0]
        assert "third" in replay[1]

    @pytest.mark.asyncio
    async def test_no_replay_without_last_event_id(self):
        """Without Last-Event-ID, no events should be replayed."""
        manager = SSEManager()
        await manager.broadcast_formatted("something")
        replay = manager.get_reconnect_events(None)
        assert len(replay) == 0


class TestRetryField:
    """Retry field is included in the SSE stream with configurable value."""

    def test_retry_in_sse_stream(self):
        """Initial retry directive should be sent when retry_ms is set."""
        formatted = format_sse_event(retry=3000)
        assert b"retry: 3000" in formatted


class TestSSEManager:
    """SSEManager can broadcast to all clients and to filtered subsets."""

    @pytest.mark.asyncio
    async def test_broadcast_to_all(self):
        """Broadcast sends to all connected clients."""
        manager = SSEManager()
        q1 = await manager.connect("client-1")
        q2 = await manager.connect("client-2")

        sent = await manager.broadcast_formatted("hello everyone")
        assert sent == 2

        # Both clients should have received the message
        msg1 = await asyncio.wait_for(q1.get(), timeout=1)
        msg2 = await asyncio.wait_for(q2.get(), timeout=1)
        assert "hello everyone" in msg1
        assert "hello everyone" in msg2

    @pytest.mark.asyncio
    async def test_broadcast_filtered(self):
        """Broadcast respects event type filters."""
        manager = SSEManager()
        q1 = await manager.connect("client-1", event_types=["news"])
        q2 = await manager.connect("client-2", event_types=["sports"])
        q3 = await manager.connect("client-3")  # No filter = receives all

        # Broadcast to news only
        sent = await manager.broadcast_formatted("news update", event_type="news")
        assert sent == 2  # client-1 and client-3

        # client-2 should not receive news
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(q2.get(), timeout=0.1)

        # client-1 and client-3 should have received it
        msg1 = await asyncio.wait_for(q1.get(), timeout=1)
        assert "news update" in msg1
        msg3 = await asyncio.wait_for(q3.get(), timeout=1)
        assert "news update" in msg3

    @pytest.mark.asyncio
    async def test_disconnect(self):
        """Disconnecting a client removes it from the manager."""
        manager = SSEManager()
        await manager.connect("client-1")
        assert len(manager.get_client_ids()) == 1

        manager.disconnect("client-1")
        assert len(manager.get_client_ids()) == 0

    @pytest.mark.asyncio
    async def test_concurrent_connections(self):
        """Multiple concurrent connections are handled without blocking."""
        manager = SSEManager()

        async def client_connect(cid: str):
            q = await manager.connect(cid)
            return q

        # Connect 10 clients concurrently
        tasks = [client_connect(f"client-{i}") for i in range(10)]
        queues = await asyncio.gather(*tasks)

        assert len(manager.get_client_ids()) == 10

        # Broadcast to all
        sent = await manager.broadcast_formatted("broadcast test")
        assert sent == 10

        # All queues should have the message
        for q in queues:
            msg = await asyncio.wait_for(q.get(), timeout=1)
            assert "broadcast test" in msg


class TestSSEEndpoint:
    """End-to-end SSE endpoint tests via TestClient."""

    def test_sse_endpoint_with_filter_and_retry(self):
        """SSE endpoint with event_type filter and retry works via TestClient."""
        # This is tested in test_sse_integration.py
        pass

    def test_sse_manager_broadcast_endpoint(self):
        """Integration: SSE endpoint using SSEManager broadcasts work."""
        # This is tested in test_sse_integration.py
        pass