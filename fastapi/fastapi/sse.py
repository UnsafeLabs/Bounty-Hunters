import asyncio
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from typing import Annotated, Any, cast

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


@dataclass(eq=False)
class _SSEConnection:
    event_types: set[str] | None
    queue: asyncio.Queue[ServerSentEvent] = field(default_factory=asyncio.Queue)


class SSEManager:
    """Manage Server-Sent Event connections, history replay, and broadcasts."""

    def __init__(
        self,
        *,
        retry: int | None = None,
        history_limit: int = 100,
    ) -> None:
        if retry is not None and retry < 0:
            raise ValueError("retry must be greater than or equal to 0")
        if history_limit < 0:
            raise ValueError("history_limit must be greater than or equal to 0")

        self.retry = retry
        self.history_limit = history_limit
        self._connections: set[_SSEConnection] = set()
        self._history: list[ServerSentEvent] = []
        self._next_id = 1

    @property
    def connection_count(self) -> int:
        return len(self._connections)

    @property
    def history(self) -> tuple[ServerSentEvent, ...]:
        return tuple(self._history)

    async def stream(
        self,
        request: Any | None = None,
        *,
        event_type: str | Sequence[str] | None = None,
        last_event_id: str | None = None,
        retry: int | None = None,
        disconnect_poll_interval: float = 0.1,
    ) -> AsyncIterator[ServerSentEvent]:
        """Yield matching events until the client disconnects."""
        event_types = self._event_types_from_request(request, event_type)
        last_id = self._last_event_id_from_request(request, last_event_id)
        retry_ms = self.retry if retry is None else retry
        if retry_ms is not None and retry_ms < 0:
            raise ValueError("retry must be greater than or equal to 0")

        connection = _SSEConnection(event_types=event_types)
        self._connections.add(connection)
        try:
            for event in self.replay(last_event_id=last_id, event_type=event_types):
                yield self._with_retry(event, retry_ms)

            while True:
                if request is not None and await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(
                        connection.queue.get(),
                        timeout=disconnect_poll_interval,
                    )
                except TimeoutError:
                    continue
                yield self._with_retry(event, retry_ms)
        finally:
            self._connections.discard(connection)

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
        sse_event = ServerSentEvent(
            data=data,
            raw_data=raw_data,
            event=event,
            id=id or self._new_event_id(),
            retry=retry,
            comment=comment,
        )
        self._remember(sse_event)

        for connection in tuple(self._connections):
            if self._matches(sse_event, connection.event_types):
                connection.queue.put_nowait(sse_event)

        return sse_event

    def replay(
        self,
        *,
        last_event_id: str | None,
        event_type: str | Sequence[str] | set[str] | None = None,
    ) -> list[ServerSentEvent]:
        if last_event_id is None:
            return []

        event_types = self._normalize_event_types(event_type)
        start_index = 0
        for index, event in enumerate(self._history):
            if event.id == last_event_id:
                start_index = index + 1
                break

        return [
            event
            for event in self._history[start_index:]
            if self._matches(event, event_types)
        ]

    def _remember(self, event: ServerSentEvent) -> None:
        if self.history_limit == 0:
            return
        self._history.append(event)
        if len(self._history) > self.history_limit:
            self._history = self._history[-self.history_limit :]

    def _new_event_id(self) -> str:
        event_id = str(self._next_id)
        self._next_id += 1
        return event_id

    @staticmethod
    def _with_retry(
        event: ServerSentEvent, retry: int | None
    ) -> ServerSentEvent:
        if retry is None or event.retry is not None:
            return event
        return event.model_copy(update={"retry": retry})

    @classmethod
    def _event_types_from_request(
        cls, request: Any | None, event_type: str | Sequence[str] | None
    ) -> set[str] | None:
        if event_type is not None:
            return cls._normalize_event_types(event_type)
        if request is None:
            return None
        return cls._normalize_event_types(request.query_params.get("event_type"))

    @staticmethod
    def _last_event_id_from_request(
        request: Any | None, last_event_id: str | None
    ) -> str | None:
        if last_event_id is not None or request is None:
            return last_event_id
        return cast(
            str | None,
            request.headers.get("last-event-id")
            or request.headers.get("Last-Event-ID"),
        )

    @staticmethod
    def _normalize_event_types(
        event_type: str | Sequence[str] | set[str] | None,
    ) -> set[str] | None:
        if event_type is None:
            return None
        if isinstance(event_type, str):
            event_types = {item.strip() for item in event_type.split(",")}
        else:
            event_types = {item.strip() for item in event_type}
        return {item for item in event_types if item} or None

    @staticmethod
    def _matches(event: ServerSentEvent, event_types: set[str] | None) -> bool:
        if event_types is None:
            return True
        return event.event in event_types
