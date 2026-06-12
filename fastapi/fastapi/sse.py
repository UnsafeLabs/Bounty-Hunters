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


import asyncio
import json
from collections import deque
from typing import Annotated, Any, AsyncGenerator, Dict, List, Optional, Set

from annotated_doc import Doc
from pydantic import AfterValidator, BaseModel, Field, model_validator
from starlette.responses import StreamingResponse
from starlette.types import Receive, Scope, Send

# ... (schemas and previous code remains)

class SSEManager:
    """Manages SSE connections, broadcasting, and event replay."""

    def __init__(self, history_size: int = 100):
        self.active_connections: Dict[str, Set[asyncio.Queue]] = {}
        self.history = deque(maxlen=history_size)
        self._lock = asyncio.Lock()

    async def subscribe(self, event_type: Optional[str] = None) -> asyncio.Queue:
        queue = asyncio.Queue()
        key = event_type or "*"
        async with self._lock:
            if key not in self.active_connections:
                self.active_connections[key] = set()
            self.active_connections[key].add(queue)
        return queue

    async def unsubscribe(self, queue: asyncio.Queue, event_type: Optional[str] = None):
        key = event_type or "*"
        async with self._lock:
            if key in self.active_connections:
                self.active_connections[key].discard(queue)
                if not self.active_connections[key]:
                    del self.active_connections[key]

    async def broadcast(self, event: "ServerSentEvent"):
        async with self._lock:
            self.history.append(event)
            # Send to specific listeners
            if event.event and event.event in self.active_connections:
                for queue in self.active_connections[event.event]:
                    await queue.put(event)
            # Send to global listeners
            if "*" in self.active_connections:
                for queue in self.active_connections["*"]:
                    await queue.put(event)

    def get_events_since(self, last_id: str) -> List["ServerSentEvent"]:
        found = False
        replay = []
        for event in self.history:
            if found:
                replay.append(event)
            if event.id == last_id:
                found = True
        return replay


class EventSourceResponse(StreamingResponse):
    """Enhanced EventSourceResponse with disconnect detection."""

    def __init__(
        self,
        content: Any,
        status_code: int = 200,
        headers: Optional[Dict[str, str]] = None,
        media_type: Optional[str] = None,
        background: Optional[Any] = None,
        ping_interval: float = 15.0,
    ) -> None:
        super().__init__(
            content, status_code, headers, "text/event-stream", background
        )
        self.ping_interval = ping_interval

    async def listen_for_disconnect(self, receive: Receive):
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                break

    async def stream_response(self, send: Send) -> None:
        await send(
            {
                "type": "http.response.start",
                "status": self.status_code,
                "headers": self.raw_headers,
            }
        )

        async for event in self.body_iterator:
            if isinstance(event, ServerSentEvent):
                chunk = format_sse_event(
                    data_str=json.dumps(event.data) if event.data else event.raw_data,
                    event=event.event,
                    id=event.id,
                    retry=event.retry,
                    comment=event.comment,
                )
            else:
                chunk = format_sse_event(data_str=json.dumps(event))
            
            await send({"type": "http.response.body", "body": chunk, "more_body": True})

        await send({"type": "http.response.body", "body": b"", "more_body": False})


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
