import asyncio
from collections import deque
from collections.abc import AsyncIterator
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


class SSEManager:
    """Manage Server-Sent Event subscribers, filtering, and replay history."""

    def __init__(
        self,
        *,
        history_size: int = 100,
        retry: int | None = None,
        disconnect_check_interval: float = 0.25,
    ) -> None:
        self.history_size = max(history_size, 0)
        self.retry = retry
        self.disconnect_check_interval = max(disconnect_check_interval, 0.001)
        self._history: deque[ServerSentEvent] = deque(maxlen=self.history_size or None)
        self._connections: set[asyncio.Queue[ServerSentEvent]] = set()
        self._lock = asyncio.Lock()

    @property
    def connection_count(self) -> int:
        return len(self._connections)

    async def broadcast(
        self,
        data: Any = None,
        *,
        event: str | None = None,
        id: str | None = None,
        retry: int | None = None,
        raw_data: str | None = None,
        comment: str | None = None,
    ) -> ServerSentEvent:
        sse_event = ServerSentEvent(
            data=data,
            raw_data=raw_data,
            event=event,
            id=id,
            retry=self.retry if retry is None else retry,
            comment=comment,
        )
        async with self._lock:
            if self.history_size:
                self._history.append(sse_event)
            connections = tuple(self._connections)
        for queue in connections:
            queue.put_nowait(sse_event)
        return sse_event

    async def stream(
        self,
        *,
        request: Request | None = None,
        event_type: str | None = None,
        last_event_id: str | None = None,
    ) -> AsyncIterator[ServerSentEvent]:
        queue: asyncio.Queue[ServerSentEvent] = asyncio.Queue()
        async with self._lock:
            replay_events = self._events_after(last_event_id)
            self._connections.add(queue)
        try:
            for sse_event in replay_events:
                if self._matches_event_type(sse_event, event_type):
                    yield sse_event
            while True:
                if await self._is_disconnected(request):
                    break
                try:
                    sse_event = await asyncio.wait_for(
                        queue.get(), timeout=self.disconnect_check_interval
                    )
                except TimeoutError:
                    continue
                if self._matches_event_type(sse_event, event_type):
                    yield sse_event
        finally:
            async with self._lock:
                self._connections.discard(queue)

    async def stream_for_request(
        self,
        request: Request,
        *,
        event_type_param: str = "event_type",
        last_event_id_header: str = "last-event-id",
    ) -> AsyncIterator[ServerSentEvent]:
        async for sse_event in self.stream(
            request=request,
            event_type=request.query_params.get(event_type_param),
            last_event_id=request.headers.get(last_event_id_header),
        ):
            yield sse_event

    def _events_after(self, last_event_id: str | None) -> list[ServerSentEvent]:
        if last_event_id is None:
            return []
        events = list(self._history)
        for index, sse_event in enumerate(events):
            if sse_event.id == last_event_id:
                return events[index + 1 :]
        return events

    def _matches_event_type(
        self, sse_event: ServerSentEvent, event_type: str | None
    ) -> bool:
        return event_type is None or sse_event.event == event_type

    async def _is_disconnected(self, request: Request | None) -> bool:
        return request is not None and await request.is_disconnected()


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
