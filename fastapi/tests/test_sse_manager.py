import asyncio

from fastapi.sse import SSEManager


class DisconnectAfter:
    def __init__(self, checks: int) -> None:
        self.checks = checks
        self.calls = 0

    async def is_disconnected(self) -> bool:
        self.calls += 1
        return self.calls >= self.checks


def test_sse_manager_filters_events_by_type() -> None:
    async def run() -> None:
        manager = SSEManager(disconnect_poll_interval=0.01)
        stream = manager.stream(event_type="metrics")
        event_task = asyncio.create_task(stream.__anext__())
        await asyncio.sleep(0)

        await manager.broadcast({"ignored": True}, event_type="logs", id="1")
        await manager.broadcast({"value": 42}, event_type="metrics", id="2")

        event = await asyncio.wait_for(event_task, timeout=1)
        assert event.data == {"value": 42}
        assert event.event == "metrics"
        await stream.aclose()

    asyncio.run(run())


def test_sse_manager_replays_events_after_last_event_id() -> None:
    async def run() -> None:
        manager = SSEManager(retry=2500)
        await manager.broadcast("one", event_type="metrics", id="1")
        await manager.broadcast("two", event_type="metrics", id="2")
        await manager.broadcast("three", event_type="logs", id="3")

        stream = manager.stream(event_type="metrics", last_event_id="1")
        event = await stream.__anext__()

        assert event.data == "two"
        assert event.id == "2"
        assert event.retry == 2500
        await stream.aclose()

    asyncio.run(run())


def test_sse_manager_broadcasts_to_concurrent_connections() -> None:
    async def run() -> None:
        manager = SSEManager(disconnect_poll_interval=0.01)
        first_stream = manager.stream()
        second_stream = manager.stream(event_type="alerts")
        first_task = asyncio.create_task(first_stream.__anext__())
        second_task = asyncio.create_task(second_stream.__anext__())
        await asyncio.sleep(0)

        await manager.broadcast("system-up", event_type="alerts", id="1")

        first = await asyncio.wait_for(first_task, timeout=1)
        second = await asyncio.wait_for(second_task, timeout=1)
        assert first.data == "system-up"
        assert second.data == "system-up"
        await first_stream.aclose()
        await second_stream.aclose()

    asyncio.run(run())


def test_sse_manager_stops_stream_when_request_disconnects() -> None:
    async def run() -> None:
        manager = SSEManager(disconnect_poll_interval=0.01)
        request = DisconnectAfter(checks=2)
        stream = manager.stream(request=request)

        try:
            await stream.__anext__()
        except StopAsyncIteration:
            pass

        assert manager.connection_count == 0
        assert request.calls >= 2

    asyncio.run(run())


def test_sse_manager_history_is_bounded() -> None:
    async def run() -> None:
        manager = SSEManager(history_size=2)
        await manager.broadcast("one", id="1")
        await manager.broadcast("two", id="2")
        await manager.broadcast("three", id="3")

        stream = manager.stream(last_event_id="missing")
        first = await stream.__anext__()
        second = await stream.__anext__()

        assert first.id == "2"
        assert second.id == "3"
        await stream.aclose()

    asyncio.run(run())
