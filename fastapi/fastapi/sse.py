from __future__ import annotations

from collections import deque
from collections.abc import AsyncIterator
from typing import Annotated, Any

import anyio
from annotated_doc import Doc
from pydantic import AfterValidator, BaseModel, Field, model_validator
from starlette.responses import StreamingResponse

# Canonical SSE event schema matching the OpenAPI 3.2 spec
# (Section 4.14.4 "Special Considerations for Server-Sent Events")
_SSE_EVENT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "data": {"type": "string"},
        "event": {"type": "string"},
        "id": {"type": "string"},
        "retry": {"type": "integer", "minimum": 0},
    },
}


class EventSourceResponse(StreamingResponse):
    """Streaming response with `text/event-stream` media type.

    Use as `response_class=EventSourceResponse` on a *path operation* that uses `yield`
    to enable Server Sent Events (SSE) responses.

    Works with **any HTTP method** (`GET`, `POST`, etc.), which makes it compatible
    with protocols like MCP that stream SSE over `POST`.

    The actual encoding logic lives in the FastAPI routing layer. This class
    serves mainly as a marker and sets the correct `Content-Type`.
    """

    media_type = "text/event-stream"


class _SSESubscriber:
    def __init__(self, event_type: str | None, max_queue_size: int) -> None:
        self.event_type = event_type
        self.send_stream, self.receive_stream = anyio.create_memory_object_stream[
            ServerSentEvent
        ](max_queue_size)

    def accepts(self, event: ServerSentEvent) -> bool:
        return self.event_type is None or event.event == self.event_type

    def put_nowait(self, event: ServerSentEvent) -> None:
        try:
            self.send_stream.send_nowait(event)
        except anyio.WouldBlock:
            self.receive_stream.receive_nowait()
            self.send_stream.send_nowait(event)

    async def close(self) -> None:
        await self.send_stream.aclose()
        await self.receive_stream.aclose()


def _check_id_no_null(v: str | None) -> str | None:
    if v is not None and "\0" in v:
        raise ValueError("SSE 'id' must not contain null characters")
    return v


class ServerSentEvent(BaseModel):
    """Represents a single Server-Sent Event.

    When `yield`ed from a *path operation function* that uses
    `response_class=EventSourceResponse`, each `ServerSentEvent` is encoded
    into the [SSE wire format](https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream)
    (`text/event-stream`).

    If you yield a plain object (dict, Pydantic model, etc.) instead, it is
    automatically JSON-encoded and sent as the `data:` field.

    All `data` values **including plain strings** are JSON-serialized.

    For example, `data="hello"` produces `data: "hello"` on the wire (with
    quotes).
    """

    data: Annotated[
        Any,
        Doc(
            """
            The event payload.

            Can be any JSON-serializable value: a Pydantic model, dict, list,
            string, number, etc. It is **always** serialized to JSON: strings
            are quoted (`"hello"` becomes `data: "hello"` on the wire).

            Mutually exclusive with `raw_data`.
            """
        ),
    ] = None
    raw_data: Annotated[
        str | None,
        Doc(
            """
            Raw string to send as the `data:` field **without** JSON encoding.

            Use this when you need to send pre-formatted text, HTML fragments,
            CSV lines, or any non-JSON payload. The string is placed directly
            into the `data:` field as-is.

            Mutually exclusive with `data`.
            """
        ),
    ] = None
    event: Annotated[
        str | None,
        Doc(
            """
            Optional event type name.

            Maps to `addEventListener(event, ...)` on the browser. When omitted,
            the browser dispatches on the generic `message` event.
            """
        ),
    ] = None
    id: Annotated[
        str | None,
        AfterValidator(_check_id_no_null),
        Doc(
            """
            Optional event ID.

            The browser sends this value back as the `Last-Event-ID` header on
            automatic reconnection. **Must not contain null (`\\0`) characters.**
            """
        ),
    ] = None
    retry: Annotated[
        int | None,
        Field(ge=0),
        Doc(
            """
            Optional reconnection time in **milliseconds**.

            Tells the browser how long to wait before reconnecting after the
            connection is lost. Must be a non-negative integer.
            """
        ),
    ] = None
    comment: Annotated[
        str | None,
        Doc(
            """
            Optional comment line(s).

            Comment lines start with `:` in the SSE wire format and are ignored by
            `EventSource` clients. Useful for keep-alive pings to prevent
            proxy/load-balancer timeouts.
            """
        ),
    ] = None

    @model_validator(mode="after")
    def _check_data_exclusive(self) -> ServerSentEvent:
        if self.data is not None and self.raw_data is not None:
            raise ValueError(
                "Cannot set both 'data' and 'raw_data' on the same "
                "ServerSentEvent. Use 'data' for JSON-serialized payloads "
                "or 'raw_data' for pre-formatted strings."
            )
        return self


class SSEManager:
    """Manage broadcast-based Server-Sent Event streams.

    `SSEManager.stream()` returns an async iterator of `ServerSentEvent` objects
    that can be returned from an endpoint using `response_class=EventSourceResponse`.
    """

    def __init__(
        self,
        *,
        history_size: int = 100,
        retry: int | None = None,
        max_queue_size: int = 100,
        disconnect_poll_interval: float = 0.1,
    ) -> None:
        self.history: deque[ServerSentEvent] = deque(maxlen=history_size)
        self.retry = retry
        self.max_queue_size = max_queue_size
        self.disconnect_poll_interval = disconnect_poll_interval
        self._subscribers: set[_SSESubscriber] = set()
        self._next_id = 1

    @property
    def connection_count(self) -> int:
        return len(self._subscribers)

    async def broadcast(
        self,
        event: ServerSentEvent | None = None,
        *,
        data: Any = None,
        raw_data: str | None = None,
        event_type: str | None = None,
        id: str | None = None,
        retry: int | None = None,
        comment: str | None = None,
    ) -> ServerSentEvent:
        if event is None:
            event = ServerSentEvent(
                data=data,
                raw_data=raw_data,
                event=event_type,
                id=id or self._make_event_id(),
                retry=retry,
                comment=comment,
            )
        elif event.id is None:
            event = event.model_copy(update={"id": self._make_event_id()})
        event = self._with_default_retry(event)
        self.history.append(event)
        for subscriber in list(self._subscribers):
            if subscriber.accepts(event):
                subscriber.put_nowait(event)
        return event

    async def broadcast_to(
        self,
        event_type: str,
        data: Any = None,
        *,
        raw_data: str | None = None,
        id: str | None = None,
        retry: int | None = None,
        comment: str | None = None,
    ) -> ServerSentEvent:
        return await self.broadcast(
            data=data,
            raw_data=raw_data,
            event_type=event_type,
            id=id,
            retry=retry,
            comment=comment,
        )

    async def stream(
        self,
        request: Any | None = None,
        *,
        event_type: str | None = None,
        last_event_id: str | None = None,
        retry: int | None = None,
    ) -> AsyncIterator[ServerSentEvent]:
        selected_event_type = self._get_event_type(request, event_type)
        selected_last_event_id = self._get_last_event_id(request, last_event_id)
        default_retry = retry if retry is not None else self.retry

        for event in self._replay_events(selected_last_event_id, selected_event_type):
            yield self._with_default_retry(event, default_retry)

        subscriber = _SSESubscriber(selected_event_type, self.max_queue_size)
        self._subscribers.add(subscriber)
        try:
            async with subscriber.receive_stream:
                while True:
                    if await self._is_disconnected(request):
                        break
                    event = None
                    with anyio.move_on_after(self.disconnect_poll_interval):
                        event = await subscriber.receive_stream.receive()
                    if event is None:
                        continue
                    yield self._with_default_retry(event, default_retry)
        except anyio.EndOfStream:
            pass
        finally:
            self._subscribers.discard(subscriber)
            await subscriber.close()

    def _make_event_id(self) -> str:
        event_id = str(self._next_id)
        self._next_id += 1
        return event_id

    def _replay_events(
        self, last_event_id: str | None, event_type: str | None
    ) -> list[ServerSentEvent]:
        events = list(self.history)
        if last_event_id is not None:
            for index, event in enumerate(events):
                if event.id == last_event_id:
                    events = events[index + 1 :]
                    break
        return [
            event for event in events if event_type is None or event.event == event_type
        ]

    def _with_default_retry(
        self, event: ServerSentEvent, retry: int | None = None
    ) -> ServerSentEvent:
        default_retry = retry if retry is not None else self.retry
        if default_retry is not None and event.retry is None:
            return event.model_copy(update={"retry": default_retry})
        return event

    def _get_event_type(
        self, request: Any | None, event_type: str | None
    ) -> str | None:
        if event_type is not None or request is None:
            return event_type
        query_params = getattr(request, "query_params", {})
        return query_params.get("event_type")

    def _get_last_event_id(
        self, request: Any | None, last_event_id: str | None
    ) -> str | None:
        if last_event_id is not None or request is None:
            return last_event_id
        headers = getattr(request, "headers", {})
        return headers.get("last-event-id") or headers.get("Last-Event-ID")

    async def _is_disconnected(self, request: Any | None) -> bool:
        if request is None or not hasattr(request, "is_disconnected"):
            return False
        return bool(await request.is_disconnected())


def format_sse_event(
    *,
    data_str: Annotated[
        str | None,
        Doc(
            """
            Pre-serialized data string to use as the `data:` field.
            """
        ),
    ] = None,
    event: Annotated[
        str | None,
        Doc(
            """
            Optional event type name (`event:` field).
            """
        ),
    ] = None,
    id: Annotated[
        str | None,
        Doc(
            """
            Optional event ID (`id:` field).
            """
        ),
    ] = None,
    retry: Annotated[
        int | None,
        Doc(
            """
            Optional reconnection time in milliseconds (`retry:` field).
            """
        ),
    ] = None,
    comment: Annotated[
        str | None,
        Doc(
            """
            Optional comment line(s) (`:` prefix).
            """
        ),
    ] = None,
) -> bytes:
    """Build SSE wire-format bytes from **pre-serialized** data.

    The result always ends with `\n\n` (the event terminator).
    """
    lines: list[str] = []

    if comment is not None:
        for line in comment.splitlines():
            lines.append(f": {line}")

    if event is not None:
        lines.append(f"event: {event}")

    if data_str is not None:
        for line in data_str.splitlines():
            lines.append(f"data: {line}")

    if id is not None:
        lines.append(f"id: {id}")

    if retry is not None:
        lines.append(f"retry: {retry}")

    lines.append("")
    lines.append("")
    return "\n".join(lines).encode("utf-8")


# Keep-alive comment, per the SSE spec recommendation
KEEPALIVE_COMMENT = b": ping\n\n"

# Seconds between keep-alive pings when a generator is idle.
# Private but importable so tests can monkeypatch it.
_PING_INTERVAL: float = 15.0
