"""
Enhanced Server-Sent Events (SSE) with disconnect detection and event filtering.
"""
import asyncio
import json
from typing import AsyncGenerator, Optional, Callable, Any, Dict
from starlette.requests import Request
from starlette.responses import StreamingResponse


class SSEManager:
    """
    SSE manager with disconnect detection, event filtering, and reconnect replay.

    Usage:
        sse = SSEManager()

        @app.get("/events")
        async def events(request: Request):
            return sse.create_response(request, event_generator())
    """

    def __init__(self, heartbeat_interval: int = 30):
        self.heartbeat_interval = heartbeat_interval
        self._event_store: Dict[str, list] = {}  # For replay
        self._max_stored_events = 100

    async def create_response(
        self,
        request: Request,
        event_generator: AsyncGenerator,
        last_event_id: Optional[str] = None,
        filter_fn: Optional[Callable] = None,
    ) -> StreamingResponse:
        """
        Create SSE response with disconnect detection.

        Args:
            request: FastAPI request (for disconnect detection)
            event_generator: Async generator yielding events
            last_event_id: Last event ID for replay (from Last-Event-ID header)
            filter_fn: Optional function to filter events
        """
        # Get last event ID from header (for reconnect)
        if last_event_id is None:
            last_event_id = request.headers.get("Last-Event-ID")

        async def stream():
            try:
                # Replay missed events if reconnecting
                if last_event_id:
                    async for event in self._replay_events(last_event_id):
                        if filter_fn is None or filter_fn(event):
                            yield self._format_event(event)

                # Stream new events
                async for event in event_generator:
                    # Check for client disconnect
                    if await request.is_disconnected():
                        break

                    if filter_fn is None or filter_fn(event):
                        # Store for replay
                        self._store_event(event)
                        yield self._format_event(event)

            except asyncio.CancelledError:
                pass
            except Exception as e:
                yield self._format_event({
                    "event": "error",
                    "data": json.dumps({"error": str(e)}),
                })

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    def _format_event(self, event: dict) -> str:
        """Format event for SSE protocol."""
        lines = []
        if "id" in event:
            lines.append(f"id: {event['id']}")
        if "event" in event:
            lines.append(f"event: {event['event']}")
        if "data" in event:
            data = event["data"]
            if isinstance(data, (dict, list)):
                data = json.dumps(data)
            for line in str(data).split("\n"):
                lines.append(f"data: {line}")
        if "retry" in event:
            lines.append(f"retry: {event['retry']}")
        lines.append("")
        return "\n".join(lines) + "\n"

    def _store_event(self, event: dict) -> None:
        """Store event for replay on reconnect."""
        stream_id = event.get("stream", "default")
        if stream_id not in self._event_store:
            self._event_store[stream_id] = []

        self._event_store[stream_id].append(event)

        # Limit stored events
        if len(self._event_store[stream_id]) > self._max_stored_events:
            self._event_store[stream_id] = self._event_store[stream_id][-self._max_stored_events:]

    async def _replay_events(self, last_event_id: str) -> AsyncGenerator:
        """Replay events after the given event ID."""
        for stream_id, events in self._event_store.items():
            found = False
            for event in events:
                if event.get("id") == last_event_id:
                    found = True
                    continue
                if found:
                    yield event


# Global instance
sse_manager = SSEManager()
