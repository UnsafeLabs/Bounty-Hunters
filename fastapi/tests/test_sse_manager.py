import asyncio
from collections.abc import AsyncIterator

from fastapi.responses import EventSourceResponse, SSEManager


class FakeRequest:
    def __init__(
        self,
        *,
        event_type: str | None = None,
        last_event_id: str | None = None,
        disconnect_after: int | None = None,
    ) -> None:
        self.query_params: dict[str, str] = {}
        if event_type is not None:
            self.query_params["event_type"] = event_type
        self.headers: dict[str, str] = {}
        if last_event_id is not None:
            self.headers["Last-Event-ID"] = last_event_id
        self.disconnect_after = disconnect_after
        self.disconnect_checks = 0

    async def is_disconnected(self) -> bool:
        self.disconnect_checks += 1
        if self.disconnect_after is None:
            return False
        return self.disconnect_checks >= self.disconnect_after


async def wait_for_connections(manager: SSEManager, count: int) -> None:
    for _ in range(10):
        if manager.connection_count == count:
            return
        await asyncio.sleep(0)
    raise AssertionError(f"Expected {count} SSE connections")


async def close_stream(stream: AsyncIterator[object]) -> None:
    aclose = getattr(stream, "aclose", None)
    if aclose is not None:
        await aclose()


def test_sse_manager_filters_by_request_query_param() -> None:
    async def run() -> None:
        manager = SSEManager(disconnect_poll_interval=0.01)
        stream = manager.stream(request=FakeRequest(event_type="metrics"))
        next_event = asyncio.create_task(stream.__anext__())
        await wait_for_connections(manager, 1)

        await manager.broadcast({"ignored": True}, event_type="logs", id="1")
        await manager.broadcast({"value": 42}, event_type="metrics", id="2")

        event = await asyncio.wait_for(next_event, timeout=1)
        assert event.data == {"value": 42}
        assert event.event == "metrics"
        await close_stream(stream)

    asyncio.run(run())


def test_sse_manager_replays_after_last_event_id_header() -> None:
    async def run() -> None:
        manager = SSEManager(retry=2500)
        await manager.broadcast("one", event_type="metrics", id="1")
        await manager.broadcast("two", event_type="metrics", id="2")
        await manager.broadcast("three", event_type="logs", id="3")

        request = FakeRequest(event_type="metrics", last_event_id="1")
        stream = manager.stream(request=request)
        event = await stream.__anext__()

        assert event.data == "two"
        assert event.id == "2"
        assert event.retry == 2500
        await close_stream(stream)

    asyncio.run(run())


def test_sse_manager_broadcasts_to_all_and_filtered_connections() -> None:
    async def run() -> None:
        manager = SSEManager(disconnect_poll_interval=0.01)
        all_stream = manager.stream()
        metrics_stream = manager.stream(event_type="metrics")
        all_event = asyncio.create_task(all_stream.__anext__())
        metrics_event = asyncio.create_task(metrics_stream.__anext__())
        await wait_for_connections(manager, 2)

        await manager.broadcast("first", event_type="logs", id="1")
        await manager.broadcast("second", event_type="metrics", id="2")

        first = await asyncio.wait_for(all_event, timeout=1)
        second = await asyncio.wait_for(metrics_event, timeout=1)
        assert first.data == "first"
        assert first.event == "logs"
        assert second.data == "second"
        assert second.event == "metrics"
        await close_stream(all_stream)
        await close_stream(metrics_stream)

    asyncio.run(run())


def test_sse_manager_stops_stream_when_request_disconnects() -> None:
    async def run() -> None:
        manager = SSEManager(disconnect_poll_interval=0.01)
        request = FakeRequest(disconnect_after=1)
        stream = manager.stream(request=request)

        try:
            await stream.__anext__()
        except StopAsyncIteration:
            pass

        assert manager.connection_count == 0
        assert request.disconnect_checks == 1

    asyncio.run(run())


def test_sse_manager_response_encodes_retry_and_sets_sse_headers() -> None:
    async def run() -> None:
        manager = SSEManager(retry=3000)
        await manager.broadcast("ready", event_type="metrics", id="1")
        await manager.broadcast({"value": 42}, event_type="metrics", id="2")

        response = manager.response(
            request=FakeRequest(event_type="metrics", last_event_id="1")
        )
        assert isinstance(response, EventSourceResponse)
        assert response.media_type == "text/event-stream"
        assert response.headers["cache-control"] == "no-cache"
        assert response.headers["x-accel-buffering"] == "no"

        chunk = await response.body_iterator.__anext__()
        assert b"event: metrics\n" in chunk
        assert b'data: {"value": 42}\n' in chunk
        assert b"id: 2\n" in chunk
        assert b"retry: 3000\n" in chunk
        await close_stream(response.body_iterator)

    asyncio.run(run())


def test_sse_manager_history_is_bounded_and_precise() -> None:
    async def run() -> None:
        manager = SSEManager(history_size=2)
        await manager.broadcast("one", id="1")
        await manager.broadcast("two", id="2")
        await manager.broadcast("three", id="3")

        stream = manager.stream(last_event_id="2")
        request = FakeRequest(disconnect_after=1)
        missing_stream = manager.stream(request=request, last_event_id="1")

        try:
            await missing_stream.__anext__()
        except StopAsyncIteration:
            pass
        else:
            raise AssertionError("Stale Last-Event-ID should not replay history")

        first = await stream.__anext__()
        assert first.data == "three"
        await close_stream(stream)

    asyncio.run(run())
