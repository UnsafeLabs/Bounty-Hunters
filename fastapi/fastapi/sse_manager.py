from __future__ import annotations

import asyncio
import json
import threading
from typing import Annotated, Any, AsyncGenerator

from annotated_doc import Doc
from pydantic import AfterValidator, BaseModel, Field, model_validator
from starlette.requests import Request
from starlette.responses import StreamingResponse

from fastapi.logger import logger

from .sse import EventSourceResponse as _EventSourceResponse, ServerSentEvent as _ServerSentEvent


class SSEManager:
    """
    Thread-safe manager for multiple SSE connections.

    Supports broadcasting to all clients or to filtered subsets by event type.
    """

    def __init__(self) -> None:
        self._connections: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()
        self._next_id = 0

    def _generate_id(self) -> int:
        with self._lock:
            i = self._next_id
            self._next_id += 1
            return i

    def register(
        self,
        connection_id: str | None = None,
        event_types: list[str] | None = None,
    ) -> str:
        """Register a new SSE connection. Returns the connection_id."""
        if connection_id is None:
            connection_id = str(self._generate_id())
        with self._lock:
            self._connections[connection_id] = {
                "event_types": event_types or [],
                "queue": asyncio.Queue(),
            }
        return connection_id

    def unregister(self, connection_id: str) -> None:
        """Remove a connection."""
        with self._lock:
            self._connections.pop(connection_id, None)

    def broadcast(
        self,
        event: ServerSentEvent,
        event_type_filter: str | None = None,
    ) -> int:
        """
        Broadcast an event to all matching connections.

        Args:
            event: The ServerSentEvent to broadcast.
            event_type_filter: If set, only connections subscribed to this event type receive the event.

        Returns:
            Number of clients that received the broadcast.
        """
        formatted = self._format_event(event)
        count = 0
        with self._lock:
            for conn_id, conn in self._connections.items():
                # If filter is set, only send to connections subscribed to that type
                if event_type_filter is not None:
                    if event_type_filter not in (conn.get("event_types") or []):
                        continue
                try:
                    conn["queue"].put_nowait(formatted)
                    count += 1
                except Exception:
                    pass
        return count

    def push_to(
        self,
        connection_id: str,
        event: ServerSentEvent,
    ) -> bool:
        """Push an event to a specific connection."""
        with self._lock:
            conn = self._connections.get(connection_id)
        if conn is None:
            return False
        formatted = self._format_event(event)
        try:
            conn["queue"].put_nowait(formatted)
            return True
        except Exception:
            return False

    def _format_event(self, event: ServerSentEvent) -> bytes:
        """Format a ServerSentEvent into SSE wire bytes."""
        lines = []
        if event.event is not None:
            lines.append(f"event: {event.event}")
        data_str = json.dumps(event.data) if event.data is not None else event.raw_data
        if data_str is not None:
            for line in data_str.splitlines():
                lines.append(f"data: {line}")
        if event.id is not None:
            lines.append(f"id: {event.id}")
        if event.retry is not None:
            lines.append(f"retry: {event.retry}")
        lines.append("")
        lines.append("")
        return "\n".join(lines).encode("utf-8")


def _check_id_no_null(v: str | None) -> str | None:
    if v is not None and "\0" in v:
        raise ValueError("SSE 'id' must not contain null characters")
    return v


class ServerSentEvent(BaseModel):
    """Represents a single Server-Sent Event."""

    data: Annotated[
        Any,
        Doc("The event payload (JSON-serialized or raw string)."),
    ] = None
    raw_data: Annotated[
        str | None,
        Doc("Pre-formatted string to send as data: without JSON encoding."),
    ] = None
    event: Annotated[
        str | None,
        Doc("Optional event type name for addEventListener(event, ...)."),
    ] = None
    id: Annotated[
        str | None,
        AfterValidator(_check_id_no_null),
        Doc("Optional event ID. Browser sends this as Last-Event-ID on reconnect."),
    ] = None
    retry: Annotated[
        int | None,
        Field(ge=0),
        Doc("Reconnection time in milliseconds."),
    ] = None
    comment: Annotated[
        str | None,
        Doc("Optional comment lines (ignored by EventSource clients)."),
    ] = None

    @model_validator(mode="after")
    def _check_data_exclusive(self) -> "ServerSentEvent":
        if self.data is not None and self.raw_data is not None:
            raise ValueError("Cannot set both 'data' and 'raw_data'.")
        return self


def format_sse_event(
    *,
    data_str: str | None = None,
    event: str | None = None,
    id: str | None = None,
    retry: int | None = None,
    comment: str | None = None,
) -> bytes:
    """Build SSE wire-format bytes."""
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


# Re-export EventSourceResponse from this module for backward compatibility
EventSourceResponse = _EventSourceResponse


async def _read_last_event_id(request: Request) -> str | None:
    """Read the Last-Event-ID header from the request."""
    return request.headers.get("Last-Event-ID")


async def _stream_with_disconnect(
    generator: AsyncGenerator[ServerSentEvent, None],
    request: Request,
    event_type_filter: str | None = None,
    last_event_id: str | None = None,
    retry_ms: int = 3000,
) -> AsyncGenerator[bytes, None]:
    """
    Wrap an event generator with:
    - Client disconnect detection (stops cleanly on disconnect)
    - Optional event type filtering
    - Last-Event-ID replay on reconnect

    Args:
        generator: The event source generator.
        event_type_filter: If set, only events with matching event type are yielded.
        last_event_id: If set, skip events with id <= last_event_id (replay after reconnect).
        retry_ms: Default retry interval in milliseconds.
    """
    last_id_seen = last_event_id or None

    async for event in generator:
        # Replay guard: skip events with id less than or equal to last seen
        if last_id_seen is not None and event.id is not None:
            if event.id <= last_id_seen:
                continue

        # Event type filter
        if event_type_filter is not None and event.event != event_type_filter:
            continue

        # Format with retry field if not already set
        retry_val = event.retry if event.retry is not None else retry_ms
        data_str = json.dumps(event.data) if event.data is not None else event.raw_data
        formatted = format_sse_event(
            data_str=data_str,
            event=event.event,
            id=event.id,
            retry=retry_val,
            comment=event.comment,
        )
        yield formatted

        if event.id is not None:
            last_id_seen = event.id

        # Check if client disconnected (connection closed)
        if await request.is_disconnected():
            logger.debug("SSE client disconnected, stopping event stream")
            break


def sse_stream(
    generator: AsyncGenerator[ServerSentEvent, None],
    request: Request,
    event_type: str | None = None,
    retry_ms: int = 3000,
) -> StreamingResponse:
    """
    Wrap a ServerSentEvent generator into a StreamingResponse with disconnect
    detection, event filtering, and Last-Event-ID replay support.

    Args:
        generator: AsyncGenerator[ServerSentEvent] yielding events.
        request: The Starlette Request (used to detect client disconnect).
        event_type: If set, only events with this type are streamed.
        retry_ms: Default retry interval in milliseconds.

    Returns:
        StreamingResponse with text/event-stream content type.
    """
    # Extract Last-Event-ID from request headers
    last_event_id = request.headers.get("Last-Event-ID")

    return StreamingResponse(
        _stream_with_disconnect(generator, request, event_type, last_event_id, retry_ms),
        media_type="text/event-stream",
    )