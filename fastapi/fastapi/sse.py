from collections import deque
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Annotated, Any

import anyio
from annotated_doc import Doc
from anyio.abc import ObjectSendStream
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


@dataclass(eq=False)
class _SSEConnection:
    event_type: str | None
    send_stream: ObjectSendStream[ServerSentEvent | None]

    def accepts(self, event: ServerSentEvent) -> bool:
        return self.event_type is None or event.event == self.event_type


class SSEManager:
    """Manage SSE subscribers, broadcast events, and replay recent events.

    `stream()` reads the standard `Last-Event-ID` header and the `event_type`
    query parameter from the request when they are not passed explicitly.
    """

    def __init__(
        self,
        *,
        history_size: Annotated[
            int,
            Doc(
                """
                Maximum number of events kept for Last-Event-ID replay.
                """
            ),
        ] = 100,
        retry: Annotated[
            int | None,
            Doc(
                """
                Default browser reconnect delay in milliseconds.
                """
            ),
        ] = None,
        disconnect_poll_interval: Annotated[
            float,
            Doc(
                """
                Seconds between client disconnect checks while idle.
                """
            ),
        ] = 0.25,
        connection_buffer_size: Annotated[
            int,
            Doc(
                """
                Per-connection event buffer size.
                """
            ),
        ] = 10,
    ) -> None:
        if history_size < 0:
            raise ValueError("history_size must be greater than or equal to 0")
        if retry is not None and retry < 0:
            raise ValueError("retry must be greater than or equal to 0")
        if disconnect_poll_interval <= 0:
            raise ValueError("disconnect_poll_interval must be greater than 0")
        if connection_buffer_size < 1:
            raise ValueError("connection_buffer_size must be greater than 0")

        self.history_size = history_size
        self.retry = retry
        self.disconnect_poll_interval = disconnect_poll_interval
        self.connection_buffer_size = connection_buffer_size
        self._history: deque[ServerSentEvent] = deque(maxlen=history_size or None)
        self._connections: set[_SSEConnection] = set()
        self._next_event_id = 1

    @property
    def connection_count(self) -> int:
        return len(self._connections)

    def get_event_type(self, request: Request | None) -> str | None:
        if request is None:
            return None
        event_type = request.query_params.get("event_type")
        return event_type or None

    def get_last_event_id(self, request: Request | None) -> str | None:
        if request is None:
            return None
        return request.headers.get("last-event-id")

    def replay(
        self,
        *,
        last_event_id: str | None = None,
        event_type: str | None = None,
    ) -> list[ServerSentEvent]:
        start = 0
        if last_event_id is not None:
            for index, event in enumerate(self._history):
                if event.id == last_event_id:
                    start = index + 1
                    break

        return [
            event
            for event in list(self._history)[start:]
            if event_type is None or event.event == event_type
        ]

    def _prepare_event(
        self,
        data: Any = None,
        *,
        raw_data: str | None = None,
        event: str | None = None,
        event_type: str | None = None,
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
                event=event if event is not None else event_type,
                id=id,
                retry=retry if retry is not None else self.retry,
                comment=comment,
            )

        if sse_event.id is None:
            sse_event = sse_event.model_copy(update={"id": str(self._next_event_id)})
            self._next_event_id += 1
        if sse_event.retry is None and self.retry is not None:
            sse_event = sse_event.model_copy(update={"retry": self.retry})
        return sse_event

    async def broadcast(
        self,
        data: Any = None,
        *,
        raw_data: str | None = None,
        event: str | None = None,
        event_type: str | None = None,
        id: str | None = None,
        retry: int | None = None,
        comment: str | None = None,
    ) -> ServerSentEvent:
        sse_event = self._prepare_event(
            data,
            raw_data=raw_data,
            event=event,
            event_type=event_type,
            id=id,
            retry=retry,
            comment=comment,
        )

        if self.history_size:
            self._history.append(sse_event)

        stale_connections: list[_SSEConnection] = []
        for connection in list(self._connections):
            if not connection.accepts(sse_event):
                continue
            try:
                connection.send_stream.send_nowait(sse_event)
            except anyio.WouldBlock:
                continue
            except (anyio.BrokenResourceError, anyio.ClosedResourceError):
                stale_connections.append(connection)

        for connection in stale_connections:
            self._connections.discard(connection)

        return sse_event

    async def broadcast_to(
        self,
        event_type: str,
        data: Any = None,
        **kwargs: Any,
    ) -> ServerSentEvent:
        return await self.broadcast(data, event_type=event_type, **kwargs)

    async def stream(
        self,
        request: Request | None = None,
        *,
        event_type: str | None = None,
        last_event_id: str | None = None,
    ) -> AsyncIterator[ServerSentEvent]:
        if event_type is None:
            event_type = self.get_event_type(request)
        if last_event_id is None:
            last_event_id = self.get_last_event_id(request)

        send_stream, receive_stream = anyio.create_memory_object_stream[
            ServerSentEvent | None
        ](self.connection_buffer_size)
        connection = _SSEConnection(event_type=event_type, send_stream=send_stream)
        self._connections.add(connection)

        async with receive_stream:
            try:
                for event in self.replay(
                    last_event_id=last_event_id, event_type=event_type
                ):
                    if request is not None and await request.is_disconnected():
                        return
                    yield event

                while True:
                    if request is not None and await request.is_disconnected():
                        return
                    try:
                        with anyio.fail_after(self.disconnect_poll_interval):
                            event = await receive_stream.receive()
                    except TimeoutError:
                        continue
                    except anyio.EndOfStream:
                        return
                    if event is None:
                        return
                    yield event
            finally:
                self._connections.discard(connection)
                await send_stream.aclose()

    async def close(self) -> None:
        for connection in list(self._connections):
            try:
                connection.send_stream.send_nowait(None)
            except (
                anyio.WouldBlock,
                anyio.BrokenResourceError,
                anyio.ClosedResourceError,
            ):
                self._connections.discard(connection)


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
