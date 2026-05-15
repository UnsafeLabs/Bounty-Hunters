import asyncio
from typing import Any

import pytest
from fastapi import FastAPI, Request
from fastapi.responses import EventSourceResponse
from fastapi.sse import ServerSentEvent, SSEManager, format_sse_event
from fastapi.testclient import TestClient


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


class FakeRequest:
    def __init__(
        self,
        *,
        query_params: dict[str, str] | None = None,
        headers: dict[str, str] | None = None,
        disconnect_after: int | None = None,
    ) -> None:
        self.query_params = query_params or {}
        self.headers = headers or {}
        self.disconnect_after = disconnect_after
        self.disconnect_checks = 0

    async def is_disconnected(self) -> bool:
        self.disconnect_checks += 1
        if self.disconnect_after is None:
            return False
        return self.disconnect_checks > self.disconnect_after


@pytest.mark.anyio
async def test_sse_manager_broadcasts_to_all_and_filtered_connections():
    manager = SSEManager()
    all_stream = manager.stream(disconnect_poll_interval=0.01)
    deploy_stream = manager.stream(event_type="deploy", disconnect_poll_interval=0.01)
    all_next = asyncio.create_task(anext(all_stream))
    deploy_next = asyncio.create_task(anext(deploy_stream))

    await asyncio.sleep(0)
    assert manager.connection_count == 2

    await manager.broadcast({"message": "audit"}, event="audit")
    all_event = await all_next
    assert all_event.event == "audit"
    assert all_event.data == {"message": "audit"}
    assert deploy_next.done() is False

    await manager.broadcast({"message": "deploy"}, event="deploy")
    deploy_event = await deploy_next
    assert deploy_event.event == "deploy"
    assert deploy_event.data == {"message": "deploy"}

    await all_stream.aclose()
    await deploy_stream.aclose()
    assert manager.connection_count == 0


@pytest.mark.anyio
async def test_sse_manager_reads_query_filter_and_replays_after_last_event_id():
    manager = SSEManager(retry=2500)
    first = await manager.broadcast("one", event="audit")
    second = await manager.broadcast("two", event="deploy")
    third = await manager.broadcast("three", event="deploy")
    await manager.broadcast("four", event="audit")
    request = FakeRequest(
        query_params={"event_type": "deploy"},
        headers={"last-event-id": first.id or ""},
    )

    stream = manager.stream(request, disconnect_poll_interval=0.01)
    replayed_second = await anext(stream)
    replayed_third = await anext(stream)

    assert replayed_second.id == second.id
    assert replayed_second.retry == 2500
    assert replayed_third.id == third.id
    assert replayed_third.retry == 2500

    await stream.aclose()
    assert manager.connection_count == 0


@pytest.mark.anyio
async def test_sse_manager_stops_and_cleans_up_on_disconnect():
    manager = SSEManager()
    request = FakeRequest(disconnect_after=0)
    stream = manager.stream(request, disconnect_poll_interval=0.01)

    with pytest.raises(StopAsyncIteration):
        await anext(stream)

    assert request.disconnect_checks == 1
    assert manager.connection_count == 0


@pytest.mark.anyio
async def test_sse_manager_handles_concurrent_connections_without_blocking():
    manager = SSEManager()
    streams = [manager.stream(disconnect_poll_interval=0.01) for _ in range(3)]
    pending = [asyncio.create_task(anext(stream)) for stream in streams]

    await asyncio.sleep(0)
    assert manager.connection_count == 3

    event = await manager.broadcast({"batch": 1}, event="batch")
    received = await asyncio.gather(*pending)

    assert [item.id for item in received] == [event.id, event.id, event.id]
    assert [item.event for item in received] == ["batch", "batch", "batch"]

    for stream in streams:
        await stream.aclose()
    assert manager.connection_count == 0


def test_sse_manager_replay_returns_events_after_matching_id():
    manager = SSEManager()
    first = asyncio.run(manager.broadcast("one", event="alpha"))
    second = asyncio.run(manager.broadcast("two", event="beta"))
    third = asyncio.run(manager.broadcast("three", event="beta"))

    replayed = manager.replay(last_event_id=first.id, event_type="beta")

    assert [event.id for event in replayed] == [second.id, third.id]
    assert [event.data for event in replayed] == ["two", "three"]


def test_sse_manager_retry_field_serializes_in_sse_stream():
    event = SSEManager(retry=1000)._with_retry(
        ServerSentEvent(data="payload", event="update", id="1"),
        retry=1000,
    )

    assert event.retry == 1000
    assert (
        format_sse_event(
            data_str='"payload"',
            event=event.event,
            id=event.id,
            retry=event.retry,
        )
        == b'event: update\ndata: "payload"\nid: 1\nretry: 1000\n\n'
    )


def test_sse_manager_streams_through_fastapi_route_with_replay_filter_and_retry():
    manager = SSEManager(retry=1500)
    first = asyncio.run(manager.broadcast("one", event="audit"))
    second = asyncio.run(manager.broadcast("two", event="deploy"))
    third = asyncio.run(manager.broadcast("three", event="deploy"))
    app = FastAPI()

    @app.get("/events", response_class=EventSourceResponse)
    async def events(request: Request):
        async for event in manager.stream(
            request,
            last_event_id=first.id,
            disconnect_poll_interval=0.01,
        ):
            yield event
            if event.id == third.id:
                break

    client = TestClient(app)
    response = client.get("/events?event_type=deploy")

    assert response.status_code == 200
    assert response.headers["content-type"] == "text/event-stream; charset=utf-8"
    assert "event: deploy\n" in response.text
    assert f"id: {second.id}\n" in response.text
    assert f"id: {third.id}\n" in response.text
    assert "data: \"one\"\n" not in response.text
    assert "retry: 1500\n" in response.text


def test_sse_manager_validates_retry_and_history_limit():
    with pytest.raises(ValueError, match="retry"):
        SSEManager(retry=-1)
    with pytest.raises(ValueError, match="history_limit"):
        SSEManager(history_limit=-1)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("alpha,beta", {"alpha", "beta"}),
        (["alpha", " beta ", ""], {"alpha", "beta"}),
        ("", None),
    ],
)
def test_sse_manager_normalizes_event_type_filters(
    value: Any, expected: set[str] | None
):
    assert SSEManager._normalize_event_types(value) == expected
