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


import asyncio
import json
import time
from typing import Any, Callable, Optional, AsyncGenerator
from starlette.requests import Request
from starlette.responses import StreamingResponse


class SSEManager:
    """Manages multiple SSE connections with event filtering and broadcast support."""

    def __init__(self):
        self._connections: dict[str, list[dict[str, Any]]] = {}
        self._event_id_counter: int = 0
        self._lock = asyncio.Lock()

    async def add_connection(self, connection_id: str, filters: Optional[list[str]] = None) -> None:
        async with self._lock:
            if connection_id not in self._connections:
                self._connections[connection_id] = []
            self._connections[connection_id].append({
                "filters": filters or [],
                "queue": asyncio.Queue(),
                "connected": True,
            })

    async def remove_connection(self, connection_id: str) -> None:
        async with self._lock:
            self._connections.pop(connection_id, None)

    async def broadcast(self, data: Any, event_type: Optional[str] = None) -> None:
        async with self._lock:
            self._event_id_counter += 1
            event_id = str(self._event_id_counter)
            for conn_id, conns in list(self._connections.items()):
                for conn in list(conns):
                    if conn["connected"]:
                        if event_type and conn["filters"] and event_type not in conn["filters"]:
                            continue
                        await conn["queue"].put({
                            "data": data,
                            "event": event_type,
                            "id": event_id,
                        })

    async def event_generator(
        self,
        connection_id: str,
        retry_ms: int = 3000,
    ) -> AsyncGenerator[bytes, None]:
        """SSE event generator for a specific connection."""
        connections = self._connections.get(connection_id, [])
        if not connections:
            return
        conn = connections[0]
        # Send initial retry
        yield f"retry: {retry_ms}\n\n".encode()
        # Send keepalive
        yield b": keepalive\n\n"
        conn["connected"] = True
        try:
            while conn["connected"]:
                try:
                    msg = await asyncio.wait_for(conn["queue"].get(), timeout=30.0)
                    lines = [f"id: {msg['id']}"]
                    if msg.get("event"):
                        lines.append(f"event: {msg['event']}")
                    lines.append(f"data: {json.dumps(msg['data'])}")
                    lines.append("")
                    yield "\n".join(lines).encode()
                except asyncio.TimeoutError:
                    # Send keepalive ping
                    yield b": keepalive\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            conn["connected"] = False


async def sse_disconnect_detected(request: Request) -> bool:
    """Check if the SSE client has disconnected."""
    try:
        return await request.is_disconnected()
    except Exception:
        return False


async def event_stream_with_disconnect(
    generator,
    request: Request,
    retry_ms: int = 3000,
    last_event_id: Optional[str] = None,
    event_filter: Optional[list[str]] = None,
) -> AsyncGenerator[bytes, None]:
    """SSE event stream with disconnect detection, last_event_id, and event filtering."""
    if retry_ms:
        yield f"retry: {retry_ms}\n\n".encode()

    async for event in generator:
        if await sse_disconnect_detected(request):
            break
        if isinstance(event, dict):
            event_type = event.get("event")
            if event_filter and event_type and event_type not in event_filter:
                continue
            eid = event.get("id")
            if last_event_id and eid and eid <= last_event_id:
                continue
            yield format_sse_event(
                data_str=json.dumps(event.get("data", event)),
                event=event_type,
                id=eid,
                retry=event.get("retry"),
            )
        else:
            yield format_sse_event(data_str=json.dumps(event))
