import asyncio
import json
from collections import deque
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Annotated, Any

from annotated_doc import Doc
from fastapi.encoders import jsonable_encoder
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


@dataclass(slots=True, eq=False)
class _SSESubscriber:
    event_type: str | None
    queue: asyncio.Queue[ServerSentEvent]


class SSEManager:
    """Manage SSE subscribers, replay history, and fan out broadcast events."""

    def __init__(
        self,
        *,
        retry: int | None = None,
        history_size: int = 100,
        disconnect_poll_interval: float = 0.1,
        queue_size: int = 100,
    ) -> None:
        if retry is not None and retry < 0:
            raise ValueError("retry must be a non-negative integer")
        if history_size < 0:
            raise ValueError("history_size must be greater than or equal to 0")
        if disconnect_poll_interval <= 0:
            raise ValueError("disconnect_poll_interval must be greater than 0")
        if queue_size <= 0:
            raise ValueError("queue_size must be greater than 0")
        self.retry = retry
        self.disconnect_poll_interval = disconnect_poll_interval
        self.queue_size = queue_size
        self._history: deque[ServerSentEvent] = deque(maxlen=history_size)
        self._subscribers: set[_SSESubscriber] = set()

    @property
    def connection_count(self) -> int:
        return len(self._subscribers)

    async def broadcast(
        self,
        data: Any = None,
        *,
        event_type: str | None = None,
        id: str | None = None,
        retry: int | None = None,
        raw_data: str | None = None,
    ) -> ServerSentEvent:
        event = ServerSentEvent(
            data=data,
            raw_data=raw_data,
            event=event_type,
            id=id,
            retry=retry if retry is not None else self.retry,
        )
        self._history.append(event)
        for subscriber in tuple(self._subscribers):
            if self._matches(subscriber.event_type, event):
                self._queue_event(subscriber, event)
        return event

    def stream(
        self,
        request: Any | None = None,
        *,
        event_type: str | None = None,
        last_event_id: str | None = None,
        retry: int | None = None,
    ) -> AsyncIterator[ServerSentEvent]:
        return self._stream(
            request=request,
            event_type=event_type,
            last_event_id=last_event_id,
            retry=retry,
        )

    def response(
        self,
        request: Any | None = None,
        *,
        event_type: str | None = None,
        last_event_id: str | None = None,
        retry: int | None = None,
    ) -> EventSourceResponse:
        response = EventSourceResponse(
            self._encoded_stream(
                request=request,
                event_type=event_type,
                last_event_id=last_event_id,
                retry=retry,
            )
        )
        response.headers["Cache-Control"] = "no-cache"
        response.headers["X-Accel-Buffering"] = "no"
        return response

    async def _encoded_stream(
        self,
        request: Any | None,
        event_type: str | None,
        last_event_id: str | None,
        retry: int | None,
    ) -> AsyncIterator[bytes]:
        async for event in self.stream(
            request=request,
            event_type=event_type,
            last_event_id=last_event_id,
            retry=retry,
        ):
            yield self._format_event(event)

    async def _stream(
        self,
        request: Any | None,
        event_type: str | None,
        last_event_id: str | None,
        retry: int | None,
    ) -> AsyncIterator[ServerSentEvent]:
        resolved_event_type = self._resolve_event_type(request, event_type)
        resolved_last_event_id = self._resolve_last_event_id(request, last_event_id)
        subscriber = _SSESubscriber(
            event_type=resolved_event_type,
            queue=asyncio.Queue(maxsize=self.queue_size),
        )
        self._subscribers.add(subscriber)
        replayed_ids: set[str] = set()
        try:
            for event in self._events_after(resolved_last_event_id):
                if self._matches(resolved_event_type, event):
                    if event.id is not None:
                        replayed_ids.add(event.id)
                    yield self._with_retry(event, retry)

            while True:
                if await self._is_disconnected(request):
                    break
                try:
                    event = await asyncio.wait_for(
                        subscriber.queue.get(),
                        timeout=self.disconnect_poll_interval,
                    )
                except asyncio.TimeoutError:
                    continue
                if event.id is not None and event.id in replayed_ids:
                    continue
                yield self._with_retry(event, retry)
        finally:
            self._subscribers.discard(subscriber)

    def _events_after(self, last_event_id: str | None) -> list[ServerSentEvent]:
        if last_event_id is None:
            return []
        history = list(self._history)
        for index, event in enumerate(history):
            if event.id == last_event_id:
                return history[index + 1 :]
        return []

    def _matches(self, event_type: str | None, event: ServerSentEvent) -> bool:
        return event_type is None or event.event == event_type

    def _queue_event(
        self,
        subscriber: _SSESubscriber,
        event: ServerSentEvent,
    ) -> None:
        try:
            subscriber.queue.put_nowait(event)
        except asyncio.QueueFull:
            try:
                subscriber.queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
            subscriber.queue.put_nowait(event)

    def _with_retry(
        self,
        event: ServerSentEvent,
        retry: int | None,
    ) -> ServerSentEvent:
        if retry is None or event.retry == retry:
            return event
        return event.model_copy(update={"retry": retry})

    def _resolve_event_type(
        self,
        request: Any | None,
        event_type: str | None,
    ) -> str | None:
        if event_type is not None:
            return event_type or None
        query_params = getattr(request, "query_params", None)
        if query_params is None:
            return None
        value = query_params.get("event_type")
        if value == "":
            return None
        return value

    def _resolve_last_event_id(
        self,
        request: Any | None,
        last_event_id: str | None,
    ) -> str | None:
        if last_event_id is not None:
            return last_event_id
        headers = getattr(request, "headers", None)
        if headers is None:
            return None
        value = headers.get("last-event-id")
        if value is None:
            value = headers.get("Last-Event-ID")
        return value

    def _format_event(self, event: ServerSentEvent) -> bytes:
        if event.raw_data is not None:
            data_str: str | None = event.raw_data
        elif event.data is not None:
            if hasattr(event.data, "model_dump_json"):
                data_str = event.data.model_dump_json()
            else:
                data_str = json.dumps(jsonable_encoder(event.data))
        else:
            data_str = None
        return format_sse_event(
            data_str=data_str,
            event=event.event,
            id=event.id,
            retry=event.retry,
            comment=event.comment,
        )

    async def _is_disconnected(self, request: Any | None) -> bool:
        if request is None:
            return False
        is_disconnected = getattr(request, "is_disconnected", None)
        if is_disconnected is None:
            return False
        return bool(await is_disconnected())
