import asyncio
from collections.abc import AsyncIterator
from itertools import count
from typing import Annotated, Any

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


class SSEConnection:
    """Async iterator for a single managed SSE client connection."""

    def __init__(
        self,
        manager: "SSEManager",
        *,
        connection_id: int,
        event_type: str | None,
        last_event_id: str | None,
        retry: int | None,
    ) -> None:
        self.manager = manager
        self.connection_id = connection_id
        self.event_type = event_type
        self.last_event_id = last_event_id
        self.retry = retry
        self._queue: asyncio.Queue[ServerSentEvent | None] = asyncio.Queue()
        self._closed = False
        self._iterator: AsyncIterator[ServerSentEvent] | None = None

    def accepts(self, event: ServerSentEvent) -> bool:
        return self.event_type is None or event.event == self.event_type

    def enqueue(self, event: ServerSentEvent) -> None:
        if not self._closed:
            self._queue.put_nowait(event)

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self.manager.disconnect(self.connection_id)
        self._queue.put_nowait(None)

    def __aiter__(self) -> "SSEConnection":
        return self

    async def __anext__(self) -> ServerSentEvent:
        if self._iterator is None:
            self._iterator = self._iterate()
        return await self._iterator.__anext__()

    async def _iterate(self) -> AsyncIterator[ServerSentEvent]:
        try:
            for event in self.manager.replay(
                last_event_id=self.last_event_id,
                event_type=self.event_type,
            ):
                yield self.manager.with_retry(event, self.retry)

            while True:
                event = await self._queue.get()
                if event is None:
                    break
                yield self.manager.with_retry(event, self.retry)
        finally:
            await self.close()


class SSEManager:
    """Manage SSE connections, filtering, replay, and broadcasts.

    `SSEManager.stream()` is intended for FastAPI endpoints that return
    `EventSourceResponse`. It reads `event_type` from the query string and
    `Last-Event-ID` from the request headers when a request is provided.
    """

    def __init__(self, *, history_size: int = 1000) -> None:
        if history_size < 0:
            raise ValueError("history_size must be greater than or equal to 0")
        self.history_size = history_size
        self._history: list[ServerSentEvent] = []
        self._connections: dict[int, SSEConnection] = {}
        self._connection_ids = count()

    @property
    def connection_count(self) -> int:
        return len(self._connections)

    def connect(
        self,
        *,
        event_type: str | None = None,
        last_event_id: str | None = None,
        retry: int | None = None,
    ) -> SSEConnection:
        connection_id = next(self._connection_ids)
        connection = SSEConnection(
            self,
            connection_id=connection_id,
            event_type=event_type,
            last_event_id=last_event_id,
            retry=retry,
        )
        self._connections[connection_id] = connection
        return connection

    def disconnect(self, connection_id: int) -> None:
        self._connections.pop(connection_id, None)

    async def stream(
        self,
        request: Any | None = None,
        *,
        event_type: str | None = None,
        last_event_id: str | None = None,
        retry: int | None = None,
    ) -> AsyncIterator[ServerSentEvent]:
        if request is not None:
            if event_type is None:
                event_type = request.query_params.get("event_type")
            if last_event_id is None:
                last_event_id = request.headers.get("last-event-id")

        connection = self.connect(
            event_type=event_type,
            last_event_id=last_event_id,
            retry=retry,
        )
        try:
            async for event in connection:
                if request is not None and await request.is_disconnected():
                    break
                yield event
        finally:
            await connection.close()

    async def broadcast(
        self,
        data: Any = None,
        *,
        raw_data: str | None = None,
        event: str | None = None,
        id: str | None = None,
        retry: int | None = None,
        comment: str | None = None,
    ) -> ServerSentEvent:
        if isinstance(data, ServerSentEvent):
            sse_event = data
        else:
            sse_event = ServerSentEvent(
                data=data,
                raw_data=raw_data,
                event=event,
                id=id,
                retry=retry,
                comment=comment,
            )

        self._remember(sse_event)
        for connection in tuple(self._connections.values()):
            if connection.accepts(sse_event):
                connection.enqueue(sse_event)
        return sse_event

    def replay(
        self,
        *,
        last_event_id: str | None,
        event_type: str | None = None,
    ) -> list[ServerSentEvent]:
        if last_event_id is None:
            return []

        start_index = -1
        for index, event in enumerate(self._history):
            if event.id == last_event_id:
                start_index = index
                break

        replay_events = (
            self._history[start_index + 1 :] if start_index >= 0 else self._history
        )
        if event_type is None:
            return list(replay_events)
        return [event for event in replay_events if event.event == event_type]

    def with_retry(
        self, event: ServerSentEvent, retry: int | None
    ) -> ServerSentEvent:
        if retry is None or event.retry is not None:
            return event
        return event.model_copy(update={"retry": retry})

    def _remember(self, event: ServerSentEvent) -> None:
        if self.history_size == 0:
            return
        self._history.append(event)
        overflow = len(self._history) - self.history_size
        if overflow > 0:
            del self._history[:overflow]


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
