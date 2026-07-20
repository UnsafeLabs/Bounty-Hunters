"""SSE disconnect detection, filtering, replay, and broadcast manager (issue #798)."""

from __future__ import annotations

import asyncio
import itertools
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Callable, Deque, Dict, Iterable, List, Optional, Set


@dataclass
class SSEEvent:
    id: str
    event: str
    data: Any
    retry: Optional[int] = None
    ts: float = field(default_factory=time.time)

    def encode(self) -> str:
        lines: List[str] = []
        if self.id is not None:
            lines.append(f"id: {self.id}")
        if self.event:
            lines.append(f"event: {self.event}")
        if self.retry is not None:
            lines.append(f"retry: {int(self.retry)}")
        payload = self.data if isinstance(self.data, str) else str(self.data)
        for part in payload.splitlines() or [""]:
            lines.append(f"data: {part}")
        return "\n".join(lines) + "\n\n"


class SSEConnection:
    def __init__(
        self,
        conn_id: str,
        *,
        event_types: Optional[Set[str]] = None,
        last_event_id: Optional[str] = None,
        retry_ms: int = 3000,
    ) -> None:
        self.conn_id = conn_id
        self.event_types = event_types  # None = all
        self.last_event_id = last_event_id
        self.retry_ms = retry_ms
        self.queue: asyncio.Queue[Optional[SSEEvent]] = asyncio.Queue()
        self.closed = False

    def accepts(self, event: SSEEvent) -> bool:
        if self.event_types is None:
            return True
        return event.event in self.event_types

    async def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        await self.queue.put(None)  # sentinel


class SSEManager:
    """
    Manage multiple SSE connections with broadcast, filtering, and replay.
    """

    def __init__(self, *, history_size: int = 256, default_retry_ms: int = 3000) -> None:
        self._id_counter = itertools.count(1)
        self._conn_counter = itertools.count(1)
        self.connections: Dict[str, SSEConnection] = {}
        self.history: Deque[SSEEvent] = deque(maxlen=history_size)
        self.default_retry_ms = default_retry_ms
        self._lock = asyncio.Lock()

    def next_event_id(self) -> str:
        return str(next(self._id_counter))

    def _events_after(self, last_event_id: Optional[str]) -> List[SSEEvent]:
        if not last_event_id:
            return []
        out: List[SSEEvent] = []
        seen = False
        for ev in self.history:
            if seen:
                out.append(ev)
            elif ev.id == last_event_id:
                seen = True
        # If id not found, replay nothing (or full history — prefer nothing for safety)
        return out

    async def connect(
        self,
        *,
        event_type: Optional[str] = None,
        event_types: Optional[Iterable[str]] = None,
        last_event_id: Optional[str] = None,
        retry_ms: Optional[int] = None,
    ) -> SSEConnection:
        types: Optional[Set[str]] = None
        if event_type:
            types = {event_type}
        if event_types:
            types = set(event_types) if types is None else types | set(event_types)

        conn = SSEConnection(
            conn_id=f"c{next(self._conn_counter)}",
            event_types=types,
            last_event_id=last_event_id,
            retry_ms=retry_ms if retry_ms is not None else self.default_retry_ms,
        )
        async with self._lock:
            self.connections[conn.conn_id] = conn
        return conn

    async def disconnect(self, conn_id: str) -> None:
        async with self._lock:
            conn = self.connections.pop(conn_id, None)
        if conn:
            await conn.close()

    async def publish(
        self,
        data: Any,
        *,
        event: str = "message",
        event_id: Optional[str] = None,
        retry: Optional[int] = None,
    ) -> SSEEvent:
        ev = SSEEvent(
            id=event_id or self.next_event_id(),
            event=event,
            data=data,
            retry=retry if retry is not None else self.default_retry_ms,
        )
        async with self._lock:
            self.history.append(ev)
            targets = list(self.connections.values())
        for conn in targets:
            if conn.closed or not conn.accepts(ev):
                continue
            await conn.queue.put(ev)
        return ev

    async def broadcast(self, data: Any, *, event: str = "message") -> SSEEvent:
        return await self.publish(data, event=event)

    async def broadcast_filtered(
        self, data: Any, *, event: str, event_types: Optional[Set[str]] = None
    ) -> SSEEvent:
        """Publish an event that only matching connections receive (via event name)."""
        return await self.publish(data, event=event)

    async def stream(self, conn: SSEConnection) -> AsyncIterator[str]:
        """
        Yield encoded SSE frames until client disconnect (conn.closed / sentinel).
        Replays history after last_event_id first, then live queue.
        """
        # Initial retry hint
        yield f"retry: {conn.retry_ms}\n\n"

        for ev in self._events_after(conn.last_event_id):
            if conn.accepts(ev):
                yield ev.encode()

        try:
            while not conn.closed:
                item = await conn.queue.get()
                if item is None:
                    break
                yield item.encode()
        except asyncio.CancelledError:
            # Client disconnect / task cancel — clean exit, no raise to caller path
            return
        finally:
            await self.disconnect(conn.conn_id)


async def sse_event_generator(
    manager: SSEManager,
    *,
    event_type: Optional[str] = None,
    last_event_id: Optional[str] = None,
    retry_ms: int = 3000,
    is_disconnected: Optional[Callable[[], bool]] = None,
) -> AsyncIterator[str]:
    """
    High-level generator: stops cleanly when `is_disconnected()` becomes True.
    """
    conn = await manager.connect(
        event_type=event_type, last_event_id=last_event_id, retry_ms=retry_ms
    )
    try:
        async for chunk in manager.stream(conn):
            if is_disconnected is not None and is_disconnected():
                break
            yield chunk
    finally:
        await manager.disconnect(conn.conn_id)
