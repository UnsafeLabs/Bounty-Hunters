import asyncio
import contextlib
import json
from collections import deque
from collections.abc import AsyncIterable, AsyncIterator
from typing import TYPE_CHECKING, Annotated, Any

from annotated_doc import Doc
from pydantic import AfterValidator, BaseModel, Field, model_validator
from starlette.responses import StreamingResponse

if TYPE_CHECKING:
    from starlette.requests import Request

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
    def _check_data_exclusive(self) -> "ServerSentEvent":
        if self.data is not None and self.raw_data is not None:
            raise ValueError(
                "Cannot set both 'data' and 'raw_data' on the same "
                "ServerSentEvent. Use 'data' for JSON-serialized payloads "
                "or 'raw_data' for pre-formatted strings."
            )
        return self


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


def _encode_event(event: ServerSentEvent) -> bytes:
    data_str = (
        event.raw_data
        if event.raw_data is not None
        else json.dumps(event.data, separators=(",", ":"))
    )
    return format_sse_event(
        data_str=data_str,
        event=event.event,
        id=event.id,
        retry=event.retry,
        comment=event.comment,
    )


class SSEManager:
    """Manage multiple Server-Sent Events connections.

    Subscribers can be grouped so that :meth:`publish` either broadcasts to
    every connected client or targets a filtered subset. Events that carry an
    ``id`` are retained in a bounded history so a reconnecting client can
    replay what it missed by sending the ``Last-Event-ID`` header.

    Publishing never blocks: events are pushed with ``Queue.put_nowait`` so a
    slow client cannot stall the broadcaster.
    """

    def __init__(self, *, history_size: int = 100, retry: int | None = None) -> None:
        self.retry = retry
        self._history: deque[ServerSentEvent] = deque(maxlen=max(history_size, 0))
        self._groups: dict[str, set[asyncio.Queue[ServerSentEvent | None]]] = {}
        self._closed = False

    def history(self) -> list[ServerSentEvent]:
        """Return the retained events, oldest first."""
        return list(self._history)

    def replay_since(self, last_event_id: str | None) -> list[ServerSentEvent]:
        """Return the retained events published after ``last_event_id``.

        An empty list is returned when no id is supplied, or when the id is no
        longer retained (the client cannot be resumed and will only see future
        events).
        """
        if last_event_id is None:
            return []
        events = list(self._history)
        ids = [event.id for event in events]
        if last_event_id not in ids:
            return []
        return events[ids.index(last_event_id) + 1 :]

    def subscriber_count(self, group: str | None = None) -> int:
        """Number of active subscribers, for one group or for all groups."""
        if group is None:
            return sum(len(queues) for queues in self._groups.values())
        return len(self._groups.get(group, ()))

    def publish(self, event: ServerSentEvent, *, group: str | None = None) -> int:
        """Broadcast ``event`` to every subscriber or to one group.

        Returns the number of subscribers the event was delivered to.
        """
        if event.id is not None:
            self._history.append(event)
        queues = self._target_queues(group)
        for queue in queues:
            queue.put_nowait(event)
        return len(queues)

    async def subscribe(
        self,
        *,
        group: str = "default",
        event_type: str | None = None,
        last_event_id: str | None = None,
    ) -> AsyncIterator[ServerSentEvent]:
        """Yield the events delivered to ``group``.

        Events missed by a reconnecting client (identified by
        ``last_event_id``) are replayed first. When ``event_type`` is set only
        events whose ``event`` field matches are yielded. Iteration ends when
        the manager (or the group) is closed.
        """
        queue: asyncio.Queue[ServerSentEvent | None] = asyncio.Queue()
        self._groups.setdefault(group, set()).add(queue)
        try:
            for event in self.replay_since(last_event_id):
                if event_type is None or event.event == event_type:
                    yield event
            if self._closed:
                return
            while True:
                event = await queue.get()
                if event is None:
                    return
                if event_type is not None and event.event != event_type:
                    continue
                yield event
        finally:
            queues = self._groups.get(group)
            if queues is not None:
                queues.discard(queue)
                if not queues:
                    self._groups.pop(group, None)

    def close(self, *, group: str | None = None) -> None:
        """Stop subscribers, either one group or all of them."""
        if group is None:
            self._closed = True
        for queue in list(self._target_queues(group)):
            queue.put_nowait(None)

    def _target_queues(
        self, group: str | None
    ) -> list[asyncio.Queue[ServerSentEvent | None]]:
        if group is None:
            return [queue for queues in self._groups.values() for queue in queues]
        return list(self._groups.get(group, ()))


async def sse_event_stream(
    events: AsyncIterable[ServerSentEvent],
    *,
    request: "Request | None" = None,
    ping_interval: float | None = None,
    retry: int | None = None,
) -> AsyncIterator[bytes]:
    """Encode ``events`` as SSE bytes, stopping cleanly on client disconnect.

    A keep-alive comment is emitted whenever no event is available within
    ``ping_interval`` seconds. When ``request`` is given, iteration stops as
    soon as the client disconnects instead of waiting for the upstream
    iterator, and the generator is not left raising on a closed connection.
    """
    interval = _PING_INTERVAL if ping_interval is None else ping_interval
    if retry is not None:
        yield format_sse_event(retry=retry)
    iterator = events.__aiter__()
    pending: asyncio.Task[ServerSentEvent] | None = None
    try:
        while True:
            if request is not None and await request.is_disconnected():
                return
            if pending is None:
                pending = asyncio.ensure_future(iterator.__anext__())
            done, _ = await asyncio.wait({pending}, timeout=interval)
            if not done:
                # The upstream iterator is still producing; keep the
                # connection warm. The pending task is deliberately kept
                # alive: cancelling ``__anext__`` would close the underlying
                # async generator.
                yield KEEPALIVE_COMMENT
                continue
            try:
                event = pending.result()
            except StopAsyncIteration:
                return
            finally:
                pending = None
            yield _encode_event(event)
    finally:
        if pending is not None:
            pending.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await pending
