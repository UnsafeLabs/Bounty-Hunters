import asyncio
from collections.abc import AsyncIterator, Iterable
from dataclasses import dataclass, field
from typing import Annotated, Any

from annotated_doc import Doc
from pydantic import AfterValidator, BaseModel, Field, model_validator
from starlette.requests import Request
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


@dataclass(eq=False, slots=True)
class SSEConnection:
    queue: asyncio.Queue[ServerSentEvent | None]
    event_type: str | None = None
    last_event_id: str | None = None


@dataclass
class SSEManager:
    """Manage SSE connections, event history, filtering, and reconnect replay."""

    retry: int = 3000
    history_size: int = 1000
    disconnect_check_interval: float = 0.1
    _connections: set[SSEConnection] = field(default_factory=set, init=False)
    _history: list[ServerSentEvent] = field(default_factory=list, init=False)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock, init=False)

    async def connect(
        self,
        *,
        event_type: str | None = None,
        last_event_id: str | None = None,
    ) -> SSEConnection:
        connection = SSEConnection(
            queue=asyncio.Queue(),
            event_type=event_type,
            last_event_id=last_event_id,
        )
        async with self._lock:
            self._connections.add(connection)
        return connection

    async def disconnect(self, connection: SSEConnection) -> None:
        async with self._lock:
            self._connections.discard(connection)
        await connection.queue.put(None)

    async def broadcast(
        self,
        event: ServerSentEvent,
        *,
        event_type: str | None = None,
    ) -> None:
        if event.retry is None:
            event = event.model_copy(update={"retry": self.retry})

        async with self._lock:
            self._remember(event)
            connections = list(self._connections)

        for connection in connections:
            if self._matches(connection, event, event_type=event_type):
                await connection.queue.put(event)

    def replay_since(
        self,
        last_event_id: str | None,
        *,
        event_type: str | None = None,
    ) -> list[ServerSentEvent]:
        if last_event_id is None:
            events = self._history
        else:
            last_seen_index = next(
                (
                    index
                    for index, event in enumerate(self._history)
                    if event.id == last_event_id
                ),
                -1,
            )
            events = self._history[last_seen_index + 1 :]
        return [
            event
            for event in events
            if event_type is None or event.event == event_type
        ]

    async def stream(
        self,
        request: Request,
        *,
        event_type: str | None = None,
        last_event_id: str | None = None,
    ) -> AsyncIterator[ServerSentEvent]:
        connection = await self.connect(
            event_type=event_type,
            last_event_id=last_event_id,
        )
        try:
            for event in self.replay_since(last_event_id, event_type=event_type):
                if await request.is_disconnected():
                    return
                yield event

            while True:
                if await request.is_disconnected():
                    return
                try:
                    event = await asyncio.wait_for(
                        connection.queue.get(),
                        timeout=self.disconnect_check_interval,
                    )
                except asyncio.TimeoutError:
                    continue
                if event is None:
                    return
                yield event
        finally:
            await self.disconnect(connection)

    def _remember(self, event: ServerSentEvent) -> None:
        self._history.append(event)
        if len(self._history) > self.history_size:
            del self._history[: len(self._history) - self.history_size]

    def _matches(
        self,
        connection: SSEConnection,
        event: ServerSentEvent,
        *,
        event_type: str | None = None,
    ) -> bool:
        requested_type = event_type or connection.event_type
        return requested_type is None or event.event == requested_type


def get_sse_filter(
    request: Request,
    *,
    event_type_param: str = "event_type",
) -> str | None:
    return request.query_params.get(event_type_param)


def get_last_event_id(request: Request) -> str | None:
    return request.headers.get("Last-Event-ID")


async def iter_sse_events(
    request: Request,
    events: Iterable[ServerSentEvent],
    *,
    event_type: str | None = None,
    last_event_id: str | None = None,
    retry: int | None = None,
) -> AsyncIterator[ServerSentEvent]:
    started = last_event_id is None
    for event in events:
        if await request.is_disconnected():
            return
        if not started:
            started = event.id == last_event_id
            continue
        if event_type is not None and event.event != event_type:
            continue
        if retry is not None and event.retry is None:
            event = event.model_copy(update={"retry": retry})
        yield event
