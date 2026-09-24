import asyncio

import pytest
from fastapi import FastAPI, Request
from fastapi.responses import EventSourceResponse
from fastapi.sse import (
    KEEPALIVE_COMMENT,
    SSEManager,
    ServerSentEvent,
    format_sse_event,
    sse_event_stream,
)
from fastapi.testclient import TestClient


async def _consume(
    manager: SSEManager, count: int, **kwargs
) -> list[ServerSentEvent]:
    """Collect ``count`` events from a subscription, then close it."""
    stream = manager.subscribe(**kwargs)
    received: list[ServerSentEvent] = []
    try:
        async for event in stream:
            received.append(event)
            if len(received) >= count:
                break
    finally:
        await stream.aclose()
    return received


class _FakeRequest:
    """Minimal stand-in exposing the ``is_disconnected`` contract."""

    def __init__(self, disconnect_after: int) -> None:
        self.calls = 0
        self.disconnect_after = disconnect_after

    async def is_disconnected(self) -> bool:
        self.calls += 1
        return self.calls > self.disconnect_after


def test_publish_broadcasts_to_all_subscribers() -> None:
    async def scenario() -> tuple[int, list[list[ServerSentEvent]]]:
        manager = SSEManager()
        first = asyncio.ensure_future(_consume(manager, 1, group="g"))
        second = asyncio.ensure_future(_consume(manager, 1, group="g"))
        await asyncio.sleep(0)
        delivered = manager.publish(ServerSentEvent(data="hello", id="1"), group="g")
        return delivered, await asyncio.gather(first, second)

    delivered, results = asyncio.run(scenario())
    assert delivered == 2
    assert all(len(received) == 1 for received in results)
    assert all(received[0].data == "hello" for received in results)


def test_publish_targets_only_the_named_group() -> None:
    async def scenario() -> tuple[int, list[ServerSentEvent]]:
        manager = SSEManager()
        targeted = asyncio.ensure_future(_consume(manager, 1, group="alerts"))
        untouched = asyncio.ensure_future(_consume(manager, 1, group="audit"))
        await asyncio.sleep(0)
        delivered = manager.publish(ServerSentEvent(data="boom", id="1"), group="alerts")
        received = await targeted
        untouched.cancel()
        with pytest.raises(asyncio.CancelledError):
            await untouched
        return delivered, received

    delivered, received = asyncio.run(scenario())
    assert delivered == 1
    assert [event.data for event in received] == ["boom"]


def test_publish_without_subscribers_is_never_blocking() -> None:
    manager = SSEManager()
    assert manager.publish(ServerSentEvent(data="nobody", id="1")) == 0
    # Events carrying an id are still retained for future reconnects.
    assert [event.id for event in manager.history()] == ["1"]


def test_subscribe_filters_live_events_by_type() -> None:
    async def scenario() -> list[ServerSentEvent]:
        manager = SSEManager()
        consumer = asyncio.ensure_future(
            _consume(manager, 1, group="g", event_type="alpha")
        )
        await asyncio.sleep(0)
        manager.publish(ServerSentEvent(data="skip", event="beta", id="1"), group="g")
        manager.publish(ServerSentEvent(data="keep", event="alpha", id="2"), group="g")
        return await consumer

    received = asyncio.run(scenario())
    assert [event.data for event in received] == ["keep"]


def test_subscribe_filters_replayed_events_by_type() -> None:
    async def scenario() -> list[ServerSentEvent]:
        manager = SSEManager()
        manager.publish(ServerSentEvent(data="one", event="alpha", id="1"))
        manager.publish(ServerSentEvent(data="two", event="beta", id="2"))
        manager.publish(ServerSentEvent(data="three", event="alpha", id="3"))
        manager.close()
        stream = manager.subscribe(event_type="alpha", last_event_id="1")
        return [event async for event in stream]

    received = asyncio.run(scenario())
    assert [event.data for event in received] == ["three"]


def test_replay_since_returns_only_missed_events() -> None:
    manager = SSEManager()
    for index in range(3):
        manager.publish(ServerSentEvent(data=index, id=str(index)))

    assert [event.id for event in manager.replay_since("1")] == ["2"]
    assert manager.replay_since(None) == []
    assert manager.replay_since("unknown") == []


def test_history_is_bounded() -> None:
    manager = SSEManager(history_size=2)
    for index in range(4):
        manager.publish(ServerSentEvent(data=index, id=str(index)))

    assert [event.id for event in manager.history()] == ["2", "3"]


def test_subscriptions_are_released_after_consumption() -> None:
    async def scenario() -> tuple[int, int]:
        manager = SSEManager()
        consumer = asyncio.ensure_future(_consume(manager, 1, group="g"))
        await asyncio.sleep(0)
        active = manager.subscriber_count()
        manager.publish(ServerSentEvent(data="done", id="1"), group="g")
        await consumer
        await asyncio.sleep(0)
        return active, manager.subscriber_count()

    active, remaining = asyncio.run(scenario())
    assert active == 1
    assert remaining == 0


def test_close_ends_all_subscriptions() -> None:
    async def scenario() -> list[ServerSentEvent]:
        manager = SSEManager()
        consumer = asyncio.ensure_future(_consume(manager, 1, group="g"))
        await asyncio.sleep(0)
        manager.close()
        return await consumer

    assert asyncio.run(scenario()) == []


def test_sse_event_stream_encodes_each_event() -> None:
    async def scenario() -> list[bytes]:
        async def source():
            yield ServerSentEvent(data="plain", id="1")
            yield ServerSentEvent(raw_data="raw value", event="custom", id="2")

        return [chunk async for chunk in sse_event_stream(source())]

    chunks = asyncio.run(scenario())
    assert chunks == [
        format_sse_event(data_str='"plain"', id="1"),
        format_sse_event(data_str="raw value", event="custom", id="2"),
    ]


def test_sse_event_stream_prepends_retry_directive() -> None:
    async def scenario() -> list[bytes]:
        async def source():
            yield ServerSentEvent(data="x", id="1")

        return [
            chunk async for chunk in sse_event_stream(source(), retry=1500)
        ]

    chunks = asyncio.run(scenario())
    assert chunks[0] == format_sse_event(retry=1500)
    assert b"data: " in chunks[1]


def test_sse_event_stream_keeps_alive_while_idle() -> None:
    async def scenario() -> list[bytes]:
        async def source():
            await asyncio.sleep(0.05)
            yield ServerSentEvent(data="late", id="1")

        return [
            chunk
            async for chunk in sse_event_stream(source(), ping_interval=0.01)
        ]

    chunks = asyncio.run(scenario())
    assert KEEPALIVE_COMMENT in chunks
    assert chunks[-1] == format_sse_event(data_str='"late"', id="1")


def test_sse_event_stream_stops_when_client_disconnects() -> None:
    async def scenario() -> list[bytes]:
        async def source():
            for index in range(5):
                yield ServerSentEvent(data=index, id=str(index))

        request = _FakeRequest(disconnect_after=2)
        return [
            chunk
            async for chunk in sse_event_stream(
                source(), request=request, ping_interval=5
            )
        ]

    # Two events are produced, then the disconnect check stops the stream.
    chunks = asyncio.run(scenario())
    assert chunks == [
        format_sse_event(data_str="0", id="0"),
        format_sse_event(data_str="1", id="1"),
    ]


def _make_app(manager: SSEManager) -> FastAPI:
    app = FastAPI()

    @app.get("/events")
    async def events(
        request: Request, event_type: str | None = None
    ) -> EventSourceResponse:
        stream = manager.subscribe(
            event_type=event_type,
            last_event_id=request.headers.get("last-event-id"),
        )
        return EventSourceResponse(sse_event_stream(stream, request=request))

    return app


def test_endpoint_replays_and_filters_by_query_parameter() -> None:
    manager = SSEManager()
    manager.publish(ServerSentEvent(data="one", event="alpha", id="1"))
    manager.publish(ServerSentEvent(data="two", event="beta", id="2"))
    manager.publish(ServerSentEvent(data="three", event="alpha", id="3"))
    manager.close()

    client = TestClient(_make_app(manager))

    every_type = client.get("/events", headers={"last-event-id": "1"})
    assert every_type.status_code == 200
    assert every_type.headers["content-type"].startswith("text/event-stream")
    # Without an event_type filter, everything after the last id is replayed.
    assert "three" in every_type.text
    assert "two" in every_type.text
    assert "one" not in every_type.text

    filtered = client.get(
        "/events",
        headers={"last-event-id": "1"},
        params={"event_type": "beta"},
    )
    assert filtered.status_code == 200
    # beta was replayed and alpha was filtered out
    assert "two" in filtered.text
    assert "three" not in filtered.text
