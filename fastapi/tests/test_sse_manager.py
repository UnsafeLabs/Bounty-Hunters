import pytest

from fastapi.sse import (
    SSEManager,
    ServerSentEvent,
    get_last_event_id,
    get_sse_filter,
    iter_sse_events,
)


class FakeRequest:
    def __init__(self, *, disconnected=False, headers=None, query_params=None):
        self.disconnected = disconnected
        self.headers = headers or {}
        self.query_params = query_params or {}

    async def is_disconnected(self):
        return self.disconnected


@pytest.mark.anyio
async def test_iter_sse_events_filters_replays_and_injects_retry():
    request = FakeRequest()
    events = [
        ServerSentEvent(data="old", event="alpha", id="1"),
        ServerSentEvent(data="match", event="beta", id="2"),
        ServerSentEvent(data="skip", event="alpha", id="3"),
        ServerSentEvent(data="next", event="beta", id="4"),
    ]

    streamed = [
        event
        async for event in iter_sse_events(
            request,
            events,
            event_type="beta",
            last_event_id="1",
            retry=5000,
        )
    ]

    assert [event.id for event in streamed] == ["2", "4"]
    assert all(event.retry == 5000 for event in streamed)


@pytest.mark.anyio
async def test_iter_sse_events_stops_on_disconnect():
    request = FakeRequest(disconnected=True)

    streamed = [
        event
        async for event in iter_sse_events(
            request,
            [ServerSentEvent(data="never", event="alpha", id="1")],
        )
    ]

    assert streamed == []


@pytest.mark.anyio
async def test_manager_broadcast_filters_connections_and_replays():
    manager = SSEManager(retry=2500)
    alpha = await manager.connect(event_type="alpha")
    beta = await manager.connect(event_type="beta")

    await manager.broadcast(ServerSentEvent(data="one", event="alpha", id="1"))
    await manager.broadcast(ServerSentEvent(data="two", event="beta", id="2"))

    assert (await alpha.queue.get()).event == "alpha"
    assert (await beta.queue.get()).event == "beta"
    assert manager.replay_since("1", event_type="beta")[0].id == "2"
    assert manager.replay_since(None, event_type="alpha")[0].retry == 2500


def test_request_helpers_read_query_and_last_event_id():
    request = FakeRequest(
        headers={"Last-Event-ID": "42"},
        query_params={"event_type": "alerts"},
    )

    assert get_sse_filter(request) == "alerts"
    assert get_last_event_id(request) == "42"
