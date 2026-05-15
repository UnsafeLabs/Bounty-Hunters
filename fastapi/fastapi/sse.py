from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
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


def get_last_event_id(request: Request) -> str | None:
    """Extract the ``Last-Event-ID`` header from an SSE reconnection request.

    Per the SSE specification, when an ``EventSource`` reconnects after a
    connection drop, it sends the **last received ``id``** as the
    ``Last-Event-ID`` header. Use this value to resume event delivery from
    the correct point.

    Args:
        request: The incoming ``Request``.

    Returns:
        The value of the ``Last-Event-ID`` header, or ``None`` if absent.
    """
    return request.headers.get("last-event-id")


class EventSourceResponse(StreamingResponse):
    """Streaming response with ``text/event-stream`` media type.

    Use as ``response_class=EventSourceResponse`` on a *path operation* that
    uses ``yield`` to enable Server-Sent Events (SSE) responses.

    Works with **any HTTP method** (``GET``, ``POST``, etc.), which makes it
    compatible with protocols like MCP that stream SSE over ``POST``.

    The actual encoding logic lives in the FastAPI routing layer. This class
    serves mainly as a marker and sets the correct ``Content-Type``.

    .. rubric:: Disconnect detection

    Pass ``request`` to enable client-disconnect detection. When the client
    disconnects during streaming, the ``on_disconnect`` callback (if
    provided) is invoked and iteration stops cleanly.

    .. rubric:: Event filtering

    Pass ``event_filter`` — a callable that receives each
    :class:`ServerSentEvent` and returns ``True`` to keep it or ``False``
    to skip it. Filtering happens before serialization, so filtered events
    are never sent over the wire.

    .. rubric:: Reconnection support

    The ``ServerSentEvent.id`` and ``ServerSentEvent.retry`` fields are
    written into the SSE wire format per the spec. Call
    :func:`get_last_event_id` on the incoming request to obtain the
    ``Last-Event-ID`` header sent by browsers on automatic reconnection.
    """

    media_type = "text/event-stream"

    def __init__(
        self,
        content: Any = None,
        status_code: int = 200,
        headers: dict[str, str] | None = None,
        media_type: str = "text/event-stream",
        background: Any = None,
        *,
        request: Request | None = None,
        on_disconnect: (
            Callable[[], Any] | Callable[[], Awaitable[Any]] | None
        ) = None,
        event_filter: Callable[[ServerSentEvent], bool] | None = None,
    ) -> None:
        super().__init__(content, status_code, headers, media_type, background)
        self.request = request
        self.on_disconnect = on_disconnect
        self.event_filter = event_filter


def _check_id_no_null(v: str | None) -> str | None:
    if v is not None and "\0" in v:
        raise ValueError("SSE 'id' must not contain null characters")
    return v


class ServerSentEvent(BaseModel):
    """Represents a single Server-Sent Event.

    When ``yield``\\ ed from a *path operation function* that uses
    ``response_class=EventSourceResponse``, each ``ServerSentEvent`` is
    encoded into the
    `SSE wire format <https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream>`_
    (``text/event-stream``).

    If you yield a plain object (dict, Pydantic model, etc.) instead, it is
    automatically JSON-encoded and sent as the ``data:`` field.

    All ``data`` values **including plain strings** are JSON-serialized.

    For example, ``data="hello"`` produces ``data: "hello"`` on the wire
    (with quotes).
    """

    data: Annotated[
        Any,
        Doc(
            """
            The event payload.

            Can be any JSON-serializable value: a Pydantic model, dict, list,
            string, number, etc. It is **always** serialized to JSON: strings
            are quoted (``"hello"`` becomes ``data: "hello"`` on the wire).

            Mutually exclusive with ``raw_data``.
            """
        ),
    ] = None
    raw_data: Annotated[
        str | None,
        Doc(
            """
            Raw string to send as the ``data:`` field **without** JSON encoding.

            Use this when you need to send pre-formatted text, HTML fragments,
            CSV lines, or any non-JSON payload. The string is placed directly
            into the ``data:`` field as-is.

            Mutually exclusive with ``data``.
            """
        ),
    ] = None
    event: Annotated[
        str | None,
        Doc(
            """
            Optional event type name.

            Maps to ``addEventListener(event, ...)`` on the browser. When
            omitted, the browser dispatches on the generic ``message`` event.
            """
        ),
    ] = None
    id: Annotated[
        str | None,
        AfterValidator(_check_id_no_null),
        Doc(
            """
            Optional event ID.

            The browser sends this value back as the ``Last-Event-ID`` header
            on automatic reconnection. **Must not contain null (\\0)
            characters.**
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

            Comment lines start with ``:`` in the SSE wire format and are
            ignored by ``EventSource`` clients. Useful for keep-alive pings to
            prevent proxy/load-balancer timeouts.
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
            Pre-serialized data string to use as the ``data:`` field.
            """
        ),
    ] = None,
    event: Annotated[
        str | None,
        Doc(
            """
            Optional event type name (``event:`` field).
            """
        ),
    ] = None,
    id: Annotated[
        str | None,
        Doc(
            """
            Optional event ID (``id:`` field).
            """
        ),
    ] = None,
    retry: Annotated[
        int | None,
        Doc(
            """
            Optional reconnection time in milliseconds (``retry:`` field).
            """
        ),
    ] = None,
    comment: Annotated[
        str | None,
        Doc(
            """
            Optional comment line(s) (``:`` prefix).
            """
        ),
    ] = None,
) -> bytes:
    """Build SSE wire-format bytes from **pre-serialized** data.

    The result always ends with ``\\n\\n`` (the event terminator).
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


async def event_stream(
    content: AsyncIterator[Any] | Iterator[Any],
    *,
    request: Request | None = None,
    on_disconnect: (
        Callable[[], Any] | Callable[[], Awaitable[Any]] | None
    ) = None,
    event_filter: Callable[[ServerSentEvent], bool] | None = None,
) -> AsyncIterator[bytes]:
    """Wrap an SSE content generator with disconnect detection, event
    filtering, and reconnection-ID tracking.

    This async generator yields fully-formatted SSE ``bytes`` suitable for
    use as the ``content`` argument of a
    :class:`~starlette.responses.StreamingResponse`.

    Usage in a route handler::

        from fastapi.responses import StreamingResponse
        from fastapi.sse import ServerSentEvent, event_stream, get_last_event_id

        @app.get("/events")
        async def events(request: Request):
            last_id = get_last_event_id(request)
            # ... use last_id to resume from the correct point ...

            async def gen():
                for i in range(100):
                    yield ServerSentEvent(
                        data={"i": i}, event="update", id=str(i)
                    )

            return StreamingResponse(
                event_stream(
                    gen(),
                    request=request,
                    on_disconnect=lambda: print("Client disconnected"),
                    event_filter=lambda ev: ev.event != "internal",
                ),
                media_type="text/event-stream",
            )

    Args:
        content: An async or sync iterator yielding
            :class:`ServerSentEvent` instances or plain JSON-serializable
            objects.
        request: Optional :class:`~starlette.requests.Request`.
            When provided, ``request.is_disconnected()`` is checked between
            items and iteration stops cleanly on disconnect.
        on_disconnect: Optional callback invoked when a client disconnect
            is detected. Can be sync or async.
        event_filter: Optional callable that receives each
            :class:`ServerSentEvent` and returns ``True`` to include it or
            ``False`` to skip it. Only applies when items are
            ``ServerSentEvent`` instances; plain objects are always
            forwarded.

    Yields:
        Fully formatted SSE ``bytes`` terminated by ``\\n\\n``.
    """
    from fastapi.encoders import jsonable_encoder

    last_event_id: str | None = None

    # Preserve the ``Last-Event-ID`` header sent by the client on
    # reconnection (per the SSE spec). The consumer of this stream is
    # responsible for using this value to resume delivery.
    if request is not None:
        last_event_id = get_last_event_id(request)

    async def _check_disconnect() -> bool:
        if request is not None and await request.is_disconnected():
            return True
        return False

    async def _invoke_on_disconnect() -> None:
        if on_disconnect is not None:
            result = on_disconnect()
            if isinstance(result, Awaitable):
                await result

    if hasattr(content, "__aiter__"):
        aiter: AsyncIterator[Any] = content  # type: ignore[assignment]
    elif hasattr(content, "__iter__"):

        async def _sync_wrapper() -> AsyncIterator[Any]:
            for item in content:  # type: ignore[union-attr]
                yield item

        aiter = _sync_wrapper()
    else:
        raise TypeError("content must be an async or sync iterator")

    async for item in aiter:
        # Check for client disconnect before processing each item
        if await _check_disconnect():
            await _invoke_on_disconnect()
            return

        # Apply event filtering for ServerSentEvent items
        if event_filter is not None and isinstance(item, ServerSentEvent):
            if not event_filter(item):
                continue

        # Serialize the item
        if isinstance(item, ServerSentEvent):
            if item.raw_data is not None:
                data_str: str | None = item.raw_data
            elif item.data is not None:
                if hasattr(item.data, "model_dump_json"):
                    data_str = item.data.model_dump_json()
                else:
                    data_str = json.dumps(jsonable_encoder(item.data))
            else:
                data_str = None

            # Track the last event ID for reconnection support
            if item.id is not None:
                last_event_id = item.id

            yield format_sse_event(
                data_str=data_str,
                event=item.event,
                id=item.id,
                retry=item.retry,
                comment=item.comment,
            )
        else:
            # Plain object — validate via jsonable_encoder and wrap in ``data``
            yield format_sse_event(
                data_str=json.dumps(jsonable_encoder(item)),
            )

    # Final disconnect check after the generator is exhausted
    if await _check_disconnect():
        await _invoke_on_disconnect()


# Keep-alive comment, per the SSE spec recommendation
KEEPALIVE_COMMENT = b": ping\n\n"

# Seconds between keep-alive pings when a generator is idle.
# Private but importable so tests can monkeypatch it.
_PING_INTERVAL: float = 15.0
