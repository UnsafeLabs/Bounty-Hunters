```diff
--- a/fastapi/fastapi/sse.py
+++ b/fastapi/fastapi/sse.py
@@ -1,6 +1,10 @@
-from typing import Annotated, Any
+import asyncio
+import json
+import time
+from typing import Annotated, Any, AsyncGenerator, Callable, Dict, List, Optional, Set
 
 from annotated_doc import Doc
+from fastapi import Request, Query
 from pydantic import AfterValidator, BaseModel, Field, model_validator
 from starlette.responses import StreamingResponse
 
@@ -15,6 +19,8 @@
         "retry": {"type": "integer", "minimum": 0},
     },
 }
+
+DEFAULT_RETRY_MS = 3000
 
 
 class EventSourceResponse(StreamingResponse):
@@ -31,6 +37,12 @@
     """
 
     media_type = "text/event-stream"
+    
+    def __init__(self, *args, retry_ms: int = DEFAULT_RETRY_MS, **kwargs):
+        super().__init__(*args, **kwargs)
+        self.retry_ms = retry_ms
+        if retry_ms:
+            self.headers.setdefault("X-Accel-Buffering", "no")
 
 
 def _check_id_no_null(v: str | None) -> str | None:
@@ -39,6 +51,7 @@
     return v
 
 
+
 class ServerSentEvent(BaseModel):
     """Represents a single Server-Sent Event.
 
@@ -101,3 +114,254 @@
             """
         ),
     ] = None
+
+
+def _format_sse(event: ServerSentEvent, retry_ms: int | None = None) -> str:
+    """Format a ServerSentEvent into the SSE wire format."""
+    lines: list[str] = []
+    
+    if event.comment:
+        for comment_line in event.comment.split("\n"):
+            lines.append(f": {comment_line}")
+    
+    if retry_ms is not None:
+        lines.append(f"retry: {retry_ms}")
+    elif event.retry is not None:
+        lines.append(f"retry: {event.retry}")
+    
+    if event.id is not None:
+        lines.append(f"id: {event.id}")
+    
+    if event.event is not None:
+        lines.append(f"event: {event.event}")
+    
+    if event.raw_data is not None:
+        for data_line in event.raw_data.split("\n"):
+            lines.append(f"data: {data_line}")
+    elif event.data is not None:
+        serialized = json.dumps(event.data, ensure_ascii=False)
+        lines.append(f"data: {serialized}")
+    
+    return "\n".join(lines) + "\n\n"
+
+
+class SSEManager:
+    """Manages multiple SSE connections and broadcasts events to connected clients.
+    
+    Supports:
+    - Broadcasting to all connected clients
+    - Broadcasting to filtered subsets based on event type subscriptions
+    - Concurrent connection handling without blocking
+    """
+    
+    def __init__(self):
+        self._connections: Dict[str, Dict[str, Any]] = {}
+        self._lock = asyncio.Lock()
+        self._event_history: List[ServerSentEvent] = []
+        self._max_history = 1000
+    
+    async def connect(
+        self,
+        client_id: str,
+        event_types: Optional[Set[str]] = None,
+        last_event_id: Optional[str] = None,
+    ) -> asyncio.Queue:
+        """Register a new SSE connection.
+        
+        Args:
+            client_id: Unique identifier for the client
+            event_types: Set of event types this client is subscribed to (None = all)
+            last_event_id: Last event ID the client received (for replay)
+            
+        Returns:
+            An asyncio.Queue that the client will consume events from
+        """
+        queue: asyncio.Queue = asyncio.Queue()
+        
+        async with self._lock:
+            self._connections[client_id] = {
+                "queue": queue,
+                "event_types": event_types,
+                "connected_at": time.time(),
+            }
+        
+        # Replay missed events if last_event_id is provided
+        if last_event_id is not None:
+            await self._replay_events(client_id, last_event_id, event_types)
+        
+        return queue
+    
+    async def disconnect(self, client_id: str) -> None:
+        """Remove a client connection."""
+        async with self._lock:
+            self._connections.pop(client_id, None)
+    
+    async def broadcast(
+        self,
+        event: ServerSentEvent,
+        event_type: Optional[str] = None,
+    ) -> None:
+        """Broadcast an event to all connected clients or filtered subsets.
+        
+        Args:
+            event: The ServerSentEvent to broadcast
+            event_type: If provided, only send to clients subscribed to this type.
+                       If None, broadcast to all clients.
+        """
+        # Store event in history for replay
+        async with self._lock:
+            self._event_history.append(event)
+            if len(self._event_history) > self._max_history:
+                self._event_history = self._event_history[-self._max_history:]
+            
+            # Determine target clients
+            targets = []
+            for client_id, conn in self._connections.items():
+                if event_type is None:
+                    targets.append(client_id)
+                elif conn["event_types"] is None or event_type in conn["event_types"]:
+                    targets.append(client_id)
+            
+            # Send to all targets concurrently
+            tasks = []
+            for client_id in targets:
+                queue = self._connections[client_id]["queue"]
+                tasks.append(asyncio.create_task(queue.put(event)))
+            
+            if tasks:
+                await asyncio.gather(*tasks, return_exceptions=True)
+    
+    async def _replay_events(
+        self,
+        client_id: str,
+        last_event_id: str,
+        event_types: Optional[Set[str]],
+    ) -> None:
+        """Replay events since last_event_id to the specified client."""
+        queue = self._connections[client_id]["queue"]
+        found = False
+        
+        for event in self._event_history:
+            if not found:
+                if event.id == last_event_id:
+                    found = True
+                continue
+            
+            # Apply event type filter
+            if event_types is not None and event.event