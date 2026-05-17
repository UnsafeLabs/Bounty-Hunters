"""Tests for SSE endpoint integration, disconnect detection via TestClient."""

import json
import time

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.sse import (
    ServerSentEvent,
    format_sse_event,
    sse_generator,
)
from fastapi.testclient import TestClient


def test_sse_retry_via_streaming_response():
    """SSE retry field can be delivered via StreamingResponse."""
    app = FastAPI()

    async def event_stream():
        yield format_sse_event(retry=5000)
        yield format_sse_event(data_str=json.dumps("hello"), event="message")

    @app.get("/sse")
    async def sse_endpoint():
        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
        )

    client = TestClient(app)
    with client.stream("GET", "/sse") as response:
        data = response.read()
        assert b"retry: 5000" in data
        assert b"hello" in data


def test_sse_event_stream_via_testclient():
    """SSE yields events that reach the HTTP response body."""
    app = FastAPI()

    async def event_gen():
        for i in range(3):
            yield ServerSentEvent(data={"count": i}, event="update")

    @app.get("/sse")
    async def sse_route():
        return StreamingResponse(
            sse_generator(
                request=None,  # type: ignore[arg-type]
                event_generator=event_gen(),
                retry_ms=3000,
            ),
            media_type="text/event-stream",
        )

    client = TestClient(app)
    with client.stream("GET", "/sse") as response:
        data = response.read()
        assert b"retry: 3000" in data
        assert b"count" in data
        assert b"update" in data


def test_sse_manager_integration():
    """SSEManager stores events that can be retrieved after broadcast."""
    from fastapi.sse import SSEManager

    manager = SSEManager()

    async def broadcast_events():
        await manager.broadcast_formatted("event-1", event_type="news")
        await manager.broadcast_formatted("event-2", event_type="news")
        await manager.broadcast_formatted("event-3", event_type="sports")

    import asyncio
    asyncio.run(broadcast_events())

    # Verify history
    assert len(manager.get_reconnect_events("0")) == 3
    assert len(manager.get_reconnect_events("1")) == 2  # events after id=1
    assert len(manager.get_reconnect_events("3")) == 0  # no events after last