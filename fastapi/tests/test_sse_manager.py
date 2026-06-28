import asyncio

import pytest
from fastapi.sse import ServerSentEvent, SSEManager, format_sse_event


class FakeRequest:
    def __init__(
        self,
        *,
        event_type: str | None = None,
        last_event_id: str | None = None,
        disconnect_after: int | None = None,
    ):
        self.query_params = {}
        if event_type is not None:
            self.query_params["event_type"] = event_type
        self.headers = {}
        if last_event_id is not None:
            self.headers["last-event-id"] = last_event_id
        self.disconnect_after = disconnect_after
        self.disconnect_checks = 0

    async def is_disconnected(self) -> bool:
        self.disconnect_checks += 1
        return (
            self.disconnect_after is not None
            and self.disconnect_checks > self.disconnect_after
        )


def run(coro):
    return asyncio.run(coro)


async def _next_event(manager: SSEManager, request: FakeRequest | None = None):
    stream = manager.stream(request=request)
    try:
        while manager.subscriber_count == 0:
            task = asyncio.create_task(stream.__anext__())
            await asyncio.sleep(0)
            if manager.subscriber_count:
                break
        await manager.broadcast({"message": "hello"}, event_type="updates")
        return await task
    finally:
        await stream.aclose()


def test_broadcast_reaches_subscriber_without_blocking():
    async def scenario():
        manager = SSEManager()
        event = await _next_event(manager)

        assert event.event == "updates"
        assert event.data == {"message": "hello"}
        assert manager.subscriber_count == 0

    run(scenario())


def test_event_type_filter_uses_request_query_parameter():
    async def scenario():
        manager = SSEManager()
        request = FakeRequest(event_type="news")
        stream = manager.stream(request=request)
        task = asyncio.create_task(stream.__anext__())
        await asyncio.sleep(0)

        await manager.broadcast("ignore", event_type="metrics")
        await asyncio.sleep(0)
        assert task.done() is False

        await manager.broadcast("deliver", event_type="news")
        event = await task
        await stream.aclose()

        assert event.data == "deliver"
        assert event.event == "news"

    run(scenario())


def test_last_event_id_replays_events_since_that_id():
    async def scenario():
        manager = SSEManager()
        await manager.broadcast("old", event_type="news", id="1")
        await manager.broadcast("new", event_type="news", id="2")
        request = FakeRequest(event_type="news", last_event_id="1")
        stream = manager.stream(request=request)

        event = await stream.__anext__()
        await stream.aclose()

        assert event.data == "new"
        assert event.id == "2"

    run(scenario())


def test_retry_is_added_to_streamed_events():
    async def scenario():
        manager = SSEManager()
        await manager.broadcast("ready", event_type="news", id="1")
        stream = manager.stream(last_event_id="0", retry=5000)

        event = await stream.__anext__()
        await stream.aclose()

        assert event.retry == 5000
        assert b"retry: 5000\n" in format_sse_event(
            data_str='"ready"',
            retry=event.retry,
        )

    run(scenario())


def test_event_retry_is_not_overridden():
    async def scenario():
        manager = SSEManager()
        await manager.broadcast("ready", event_type="news", id="1", retry=1000)
        stream = manager.stream(last_event_id="0", retry=5000)

        event = await stream.__anext__()
        await stream.aclose()

        assert event.retry == 1000

    run(scenario())


def test_disconnect_stops_stream_and_removes_subscriber():
    async def scenario():
        manager = SSEManager()
        request = FakeRequest(disconnect_after=0)
        stream = manager.stream(request=request, disconnect_poll_interval=0.01)

        with pytest.raises(StopAsyncIteration):
            await stream.__anext__()
        await stream.aclose()

        assert manager.subscriber_count == 0

    run(scenario())


def test_bounded_history_keeps_recent_replay_events():
    async def scenario():
        manager = SSEManager(history_size=2)
        await manager.broadcast("one", id="1")
        await manager.broadcast("two", id="2")
        await manager.broadcast("three", id="3")
        stream = manager.stream(last_event_id="1")

        event = await stream.__anext__()
        await stream.aclose()

        assert event.data == "two"

    run(scenario())


def test_invalid_manager_configuration_raises():
    with pytest.raises(ValueError, match="history_size"):
        SSEManager(history_size=-1)
    with pytest.raises(ValueError, match="max_queue_size"):
        SSEManager(max_queue_size=0)


def test_server_sent_event_format_still_accepts_manager_events():
    event = ServerSentEvent(raw_data="payload", event="news", id="7", retry=3000)

    assert (
        format_sse_event(
            data_str=event.raw_data,
            event=event.event,
            id=event.id,
            retry=event.retry,
        )
        == b"event: news\ndata: payload\nid: 7\nretry: 3000\n\n"
    )
