"""
Fix: Add SSE disconnect detection, event filtering, and
automatic reconnection with event replay (#798)

Problem: SSE connections don't detect client disconnect,
no event filtering, and no reconnection support with
event replay for missed events.

Solution: Async disconnect detection, event ID tracking,
filterable subscriptions, and replay buffer.
"""

import asyncio
import json
import time
from typing import Any, AsyncIterator, Callable, Optional
from dataclasses import dataclass, field
from collections import deque

from fastapi import Request
from fastapi.responses import StreamingResponse
from sse_starlette.sse import EventSourceResponse


@dataclass
class SSEEvent:
    event: str
    data: Any
    event_id: str
    timestamp: float = field(default_factory=time.time)
    channel: str = "default"
    priority: int = 0  # 0=normal, 1=high, 2=critical


class SSEManager:
    def __init__(self, replay_buffer_size: int = 1000, disconnect_timeout: float = 30.0):
        self._subscribers: dict[str, asyncio.Queue] = {}
        self._replay_buffer: deque[SSEEvent] = deque(maxlen=replay_buffer_size)
        self._disconnect_timeout = disconnect_timeout
        self._event_counter = 0

    async def publish(self, event: str, data: Any, channel: str = "default", priority: int = 0) -> str:
        self._event_counter += 1
        event_id = f"evt_{self._event_counter}_{int(time.time()*1000)}"
        
        sse_event = SSEEvent(
            event=event,
            data=data,
            event_id=event_id,
            channel=channel,
            priority=priority,
        )
        
        self._replay_buffer.append(sse_event)
        
        # Send to all subscribers (filter by channel)
        dead_queues = []
        for sub_id, queue in self._subscribers.items():
            try:
                queue.put_nowait(sse_event)
            except asyncio.QueueFull:
                dead_queues.append(sub_id)
        
        for sub_id in dead_queues:
            self._subscribers.pop(sub_id, None)
        
        return event_id

    async def subscribe(
        self,
        request: Request,
        channels: Optional[list[str]] = None,
        last_event_id: Optional[str] = None,
        filter_fn: Optional[Callable[[SSEEvent], bool]] = None,
    ) -> AsyncIterator[dict]:
        queue = asyncio.Queue(maxsize=500)
        sub_id = f"sub_{id(queue)}"
        self._subscribers[sub_id] = queue

        try:
            # Replay missed events if last_event_id provided
            if last_event_id:
                replay_events = self._get_events_after(last_event_id, channels)
                for evt in replay_events:
                    if filter_fn and not filter_fn(evt):
                        continue
                    yield self._format_event(evt)

            # Stream new events with disconnect detection
            while True:
                # Check if client disconnected
                if await request.is_disconnected():
                    break

                try:
                    event = await asyncio.wait_for(
                        queue.get(), timeout=self._disconnect_timeout
                    )
                except asyncio.TimeoutError:
                    # Send keepalive
                    yield {"event": "ping", "data": ""}
                    continue

                # Apply channel filter
                if channels and event.channel not in channels:
                    continue

                # Apply custom filter
                if filter_fn and not filter_fn(event):
                    continue

                yield self._format_event(event)

        finally:
            self._subscribers.pop(sub_id, None)

    def _get_events_after(self, last_event_id: str, channels: Optional[list[str]] = None) -> list[SSEEvent]:
        events = []
        found = False
        for evt in self._replay_buffer:
            if evt.event_id == last_event_id:
                found = True
                continue
            if found:
                if channels is None or evt.channel in channels:
                    events.append(evt)
        return events

    @staticmethod
    def _format_event(event: SSEEvent) -> dict:
        return {
            "id": event.event_id,
            "event": event.event,
            "data": json.dumps(event.data) if not isinstance(event.data, str) else event.data,
        }

    def get_subscriber_count(self) -> int:
        return len(self._subscribers)
