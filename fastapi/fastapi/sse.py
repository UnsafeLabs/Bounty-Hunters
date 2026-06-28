import asyncio
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


class _SSESubscriber:
    def __init__(
        self,
        *,
        event_type: str | None,
        max_queue_size: int,
    ):
        self.event_type = event_type
        self.queue: asyncio.Queue[ServerSentEvent] = asyncio.Queue(
            maxsize=max_queue_size
        )

    def matches(self, event: ServerSentEvent) -> bool:
        return self.event_type is None or event.event == self.event_type


class SSEManager:
    def __init__(
        self,
        *,
        history_size: int = 100,
        max_queue_size: int = 100,
    ):
        if history_size < 0:
            raise ValueError("history_size must be greater than or equal to 0")
        if max_queue_size < 1:
            raise ValueError("max_queue_size must be greater than 0")
        self.history_size = history_size
        self.max_queue_size = max_queue_size
        self._history: list[ServerSentEvent] = []
        self._subscribers: list[_SSESubscriber] = []
        self._lock = asyncio.Lock()
        self._next_id = 1

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    async def broadcast(
        self,
        data: Any = None,
        *,
        raw_data: str | None = None,
        event_type: str | None = None,
        id: str | None = None,
        retry: int | None = None,
    ) -> ServerSentEvent:
        event = ServerSentEvent(
            data=data,
            raw_data=raw_data,
            event=event_type,
            id=id or self._new_event_id(),
            retry=retry,
        )
        async with self._lock:
            self._append_history(event)
            subscribers = list(self._subscribers)
        for subscriber in subscribers:
            if subscriber.matches(event):
                self._queue_event(subscriber, event)
        return event

    async def stream(
        self,
        request: Request | None = None,
        *,
        event_type: str | None = None,
        last_event_id: str | None = None,
        retry: int | None = None,
        disconnect_poll_interval: float = 0.1,
    ) -> AsyncIterator[ServerSentEvent]:
        if request is not None:
            event_type = event_type or request.query_params.get("event_type")
            last_event_id = last_event_id or request.headers.get("last-event-id")
        subscriber = _SSESubscriber(
            event_type=event_type,
            max_queue_size=self.max_queue_size,
        )
        async with self._lock:
            self._subscribers.append(subscriber)
            replay_events = self._replay_events(
                event_type=event_type,
                last_event_id=last_event_id,
            )
        try:
            for event in replay_events:
                if await self._is_disconnected(request):
                    return
                yield self._with_retry(event, retry)

            while True:
                if await self._is_disconnected(request):
                    return
                try:
                    event = await asyncio.wait_for(
                        subscriber.queue.get(),
                        timeout=disconnect_poll_interval,
                    )
                except TimeoutError:
                    continue
                yield self._with_retry(event, retry)
        finally:
            async with self._lock:
                self._subscribers = [
                    current
                    for current in self._subscribers
                    if current is not subscriber
                ]

    def _new_event_id(self) -> str:
        event_id = str(self._next_id)
        self._next_id += 1
        return event_id

    def _append_history(self, event: ServerSentEvent) -> None:
        if self.history_size == 0:
            return
        self._history.append(event)
        if len(self._history) > self.history_size:
            self._history = self._history[-self.history_size :]

    def _replay_events(
        self,
        *,
        event_type: str | None,
        last_event_id: str | None,
    ) -> list[ServerSentEvent]:
        if not last_event_id:
            return []
        replay_start = 0
        for index, event in enumerate(self._history):
            if event.id == last_event_id:
                replay_start = index + 1
                break
        events = self._history[replay_start:]
        if event_type is not None:
            return [event for event in events if event.event == event_type]
        return events

    @staticmethod
    def _queue_event(subscriber: _SSESubscriber, event: ServerSentEvent) -> None:
        try:
            subscriber.queue.put_nowait(event)
        except asyncio.QueueFull:
            try:
                subscriber.queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
            subscriber.queue.put_nowait(event)

    @staticmethod
    def _with_retry(
        event: ServerSentEvent,
        retry: int | None,
    ) -> ServerSentEvent:
        if retry is None or event.retry is not None:
            return event
        return event.model_copy(update={"retry": retry})

    @staticmethod
    async def _is_disconnected(request: Request | None) -> bool:
        if request is None:
            return False
        return await request.is_disconnected()
