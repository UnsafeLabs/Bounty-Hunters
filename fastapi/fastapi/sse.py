"""
Server-Sent Events (SSE) utilities for FastAPI.

Provides SSEManager for managing client connections with:
- Automatic disconnect detection
- Event filtering by type
- Reconnect support with last_event_id
- Connection tracking and cleanup
"""

import asyncio
import json
import time
import uuid
from typing import Any, AsyncIterator, Callable, Dict, List, Optional, Set, TypeVar, Generic
from pydantic import BaseModel
from starlette.responses import StreamingResponse
from starlette.requests import Request

T = TypeVar('T')


class SSEClient(BaseModel):
    """Represents a connected SSE client."""
    client_id: str
    connected_at: float
    last_sent_at: float
    last_event_id: Optional[str] = None
    disconnected_at: Optional[float] = None
    disconnected: bool = False
    
    class Config:
        arbitrary_types_allowed = True


class SSEEvent(BaseModel):
    """Represents an SSE event to be sent to clients."""
    event_type: str
    data: Any
    event_id: Optional[str] = None
    retry: Optional[int] = None
    
    class Config:
        arbitrary_types_allowed = True


class SSEManager(Generic[T]):
    """
    Manages Server-Sent Events connections and message broadcasting.
    
    Features:
    - Automatic disconnect detection via heartbeat
    - Event filtering by type
    - Reconnect support with last_event_id
    - Connection tracking and cleanup
    """
    
    def __init__(
        self,
        heartbeat_interval: float = 30.0,
        disconnect_timeout: float = 60.0,
        max_event_history: int = 100
    ):
        """
        Initialize SSEManager.
        
        Args:
            heartbeat_interval: Seconds between heartbeat checks (default: 30s)
            disconnect_timeout: Seconds without response before considering disconnected (default: 60s)
            max_event_history: Maximum number of events to keep in history for replay (default: 100)
        """
        self._clients: Dict[str, SSEClient] = {}
        self._event_history: List[Dict[str, Any]] = []
        self._event_counter: int = 0
        self._heartbeat_interval = heartbeat_interval
        self._disconnect_timeout = disconnect_timeout
        self._max_event_history = max_event_history
        self._listeners: Dict[str, Set[Callable[[str, Dict[str, Any]], None]]] = {}
        self._lock = asyncio.Lock()
        self._running = False
        self._cleanup_task: Optional[asyncio.Task] = None
    
    async def start(self) -> None:
        """Start the SSE manager and background cleanup task."""
        if self._running:
            return
        
        self._running = True
        self._cleanup_task = asyncio.create_task(self._cleanup_disconnected())
    
    async def stop(self) -> None:
        """Stop the SSE manager and cleanup all connections."""
        self._running = False
        
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
        
        async with self._lock:
            for client_id, client in self._clients.items():
                client.disconnected = True
                client.disconnected_at = time.time()
    
    async def _cleanup_disconnected(self) -> None:
        """Background task to cleanup disconnected clients."""
        while self._running:
            await asyncio.sleep(self._heartbeat_interval)
            
            current_time = time.time()
            disconnected_clients = []
            
            async with self._lock:
                for client_id, client in self._clients.items():
                    if client.disconnected:
                        if client.disconnected_at and (current_time - client.disconnected_at) > self._disconnect_timeout:
                            disconnected_clients.append(client_id)
                    elif (current_time - client.last_sent_at) > self._disconnect_timeout * 2:
                        # Client hasn't received anything in a while, mark as disconnected
                        client.disconnected = True
                        client.disconnected_at = current_time
            
            # Remove disconnected clients
            for client_id in disconnected_clients:
                async with self._lock:
                    if client_id in self._clients:
                        del self._clients[client_id]
    
    def _generate_event_id(self) -> str:
        """Generate a unique event ID."""
        self._event_counter += 1
        return f"{self._event_counter}-{time.time_ns()}"
    
    async def connect(self, request: Request) -> str:
        """
        Register a new client connection.
        
        Args:
            request: FastAPI/Starlette request object
            
        Returns:
            Unique client ID
        """
        client_id = str(uuid.uuid4())
        current_time = time.time()
        
        async with self._lock:
            self._clients[client_id] = SSEClient(
                client_id=client_id,
                connected_at=current_time,
                last_sent_at=current_time,
                disconnected=False
            )
        
        return client_id
    
    async def disconnect(self, client_id: str) -> None:
        """
        Mark a client as disconnected.
        
        Args:
            client_id: The client ID to disconnect
        """
        async with self._lock:
            if client_id in self._clients:
                self._clients[client_id].disconnected = True
                self._clients[client_id].disconnected_at = time.time()
    
    async def is_connected(self, client_id: str) -> bool:
        """
        Check if a client is currently connected.
        
        Args:
            client_id: The client ID to check
            
        Returns:
            True if connected, False otherwise
        """
        async with self._lock:
            client = self._clients.get(client_id)
            if not client:
                return False
            if client.disconnected:
                return False
            # Check if client has timed out
            if (time.time() - client.last_sent_at) > self._disconnect_timeout:
                client.disconnected = True
                client.disconnected_at = time.time()
                return False
            return True
    
    async def broadcast(
        self,
        event_type: str,
        data: Any,
        retry: Optional[int] = None,
        exclude_clients: Optional[Set[str]] = None
    ) -> str:
        """
        Broadcast an event to all connected clients.
        
        Args:
            event_type: The type of event (e.g., 'message', 'update')
            data: The event data to send
            retry: Optional retry interval in milliseconds
            exclude_clients: Set of client IDs to exclude
            
        Returns:
            The event ID for this broadcast
        """
        event_id = self._generate_event_id()
        event_data = {
            "event_type": event_type,
            "data": data,
            "event_id": event_id,
            "retry": retry,
            "timestamp": time.time()
        }
        
        # Store in history
        async with self._lock:
            self._event_history.append(event_data)
            if len(self._event_history) > self._max_event_history:
                self._event_history = self._event_history[-self._max_event_history:]
        
        # Send to all connected clients
        current_time = time.time()
        disconnected_clients = []
        
        async with self._lock:
            for client_id, client in self._clients.items():
                if client.disconnected:
                    continue
                if exclude_clients and client_id in exclude_clients:
                    continue
                
                # Check if client is still connected (heartbeat check)
                if (current_time - client.last_sent_at) > self._disconnect_timeout:
                    client.disconnected = True
                    client.disconnected_at = current_time
                    disconnected_clients.append(client_id)
                    continue
                
                # Update last sent time
                client.last_sent_at = current_time
                client.last_event_id = event_id
        
        # Notify listeners
        await self._notify_listeners(event_type, event_data)
        
        return event_id
    
    async def broadcast_to_client(
        self,
        client_id: str,
        event_type: str,
        data: Any,
        retry: Optional[int] = None
    ) -> bool:
        """
        Send an event to a specific client.
        
        Args:
            client_id: The client ID to send to
            event_type: The type of event
            data: The event data
            retry: Optional retry interval in milliseconds
            
        Returns:
            True if sent successfully, False if client is disconnected
        """
        async with self._lock:
            client = self._clients.get(client_id)
            if not client or client.disconnected:
                return False
            
            current_time = time.time()
            if (current_time - client.last_sent_at) > self._disconnect_timeout:
                client.disconnected = True
                client.disconnected_at = current_time
                return False
            
            event_id = self._generate_event_id()
            event_data = {
                "event_type": event_type,
                "data": data,
                "event_id": event_id,
                "retry": retry,
                "timestamp": current_time
            }
            
            client.last_sent_at = current_time
            client.last_event_id = event_id
            
            # Store in history
            self._event_history.append(event_data)
            if len(self._event_history) > self._max_event_history:
                self._event_history = self._event_history[-self._max_event_history:]
        
        return True
    
    async def get_events_since(
        self,
        last_event_id: Optional[str] = None,
        event_types: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        """
        Get events since a specific event ID (for reconnection/replay).
        
        Args:
            last_event_id: The last event ID the client received
            event_types: Optional list of event types to filter by
            
        Returns:
            List of events since the specified ID
        """
        async with self._lock:
            if not last_event_id:
                # Return all events from history
                events = self._event_history.copy()
            else:
                # Find index of last event
                try:
                    # Extract counter from event ID
                    last_counter = int(last_event_id.split('-')[0])
                    events = [e for e in self._event_history if int(e['event_id'].split('-')[0]) > last_counter]
                except (ValueError, IndexError):
                    # Invalid event ID, return all
                    events = self._event_history.copy()
            
            # Filter by event types if specified
            if event_types:
                events = [e for e in events if e['event_type'] in event_types]
            
            return events
    
    async def subscribe(
        self,
        client_id: str,
        event_types: Optional[List[str]] = None
    ) -> AsyncIterator[Dict[str, Any]]:
        """
        Create an async iterator for a client to receive events.
        
        Args:
            client_id: The client ID
            event_types: Optional list of event types to filter by
            
        Yields:
            Event data dictionaries
        """
        queue = asyncio.Queue()
        
        async def listener(event_type: str, event_data: Dict[str, Any]) -> None:
            if event_types is None or event_type in event_types:
                await queue.put(event_data)
        
        # Add listener for all event types
        if event_types:
            for et in event_types:
                if et not in self._listeners:
                    self._listeners[et] = set()
                self._listeners[et].add(listener)
        else:
            # Listen to all types
            for et in self._listeners:
                self._listeners[et].add(listener)
        
        try:
            # First, send any missed events (replay)
            async with self._lock:
                client = self._clients.get(client_id)
                if client and client.last_event_id:
                    events = await self.get_events_since(client.last_event_id, event_types)
                    for event in events:
                        await queue.put(event)
        except:
            pass
        
        try:
            while True:
                event = await queue.get()
                yield event
        finally:
            # Cleanup listener
            if event_types:
                for et in event_types:
                    if et in self._listeners:
                        self._listeners[et].discard(listener)
            else:
                for et in self._listeners:
                    self._listeners[et].discard(listener)
    
    async def _notify_listeners(self, event_type: str, event_data: Dict[str, Any]) -> None:
        """Notify all listeners for a specific event type."""
        if event_type in self._listeners:
            for listener in self._listeners[event_type]:
                try:
                    listener(event_type, event_data)
                except:
                    pass
    
    async def get_client(self, client_id: str) -> Optional[SSEClient]:
        """Get a client by ID."""
        async with self._lock:
            return self._clients.get(client_id)
    
    async def get_all_clients(self) -> List[SSEClient]:
        """Get all currently connected clients."""
        async with self._lock:
            return list(self._clients.values())
    
    async def get_connected_client_count(self) -> int:
        """Get the number of currently connected clients."""
        async with self._lock:
            return sum(1 for c in self._clients.values() if not c.disconnected)


# Global SSE manager instance
sse_manager = SSEManager[Any]()


# FastAPI dependency
async def get_sse_manager() -> SSEManager[Any]:
    """FastAPI dependency to get the SSE manager."""
    return sse_manager


class SSEDisconnectError(Exception):
    """Raised when a client is disconnected."""
    pass


class SSEFilterError(Exception):
    """Raised when event filtering fails."""
    pass


async def sse_endpoint(
    request: Request,
    event_types: Optional[str] = None,
    last_event_id: Optional[str] = None
) -> StreamingResponse:
    """
    SSE endpoint that streams events to the client.
    
    Usage:
        @app.get("/sse")
        async def sse_stream(
            request: Request,
            event_types: Optional[str] = None,
            last_event_id: Optional[str] = None
        ):
            return await sse_endpoint(request, event_types, last_event_id)
    
    Args:
        request: FastAPI/Starlette request
        event_types: Comma-separated list of event types to subscribe to
        last_event_id: Last event ID received by client (for replay)
        
    Returns:
        StreamingResponse with SSE events
    """
    # Connect client
    client_id = await sse_manager.connect(request)
    
    # Parse event types
    subscribed_types = None
    if event_types:
        subscribed_types = [et.strip() for et in event_types.split(',') if et.strip()]
    
    async def event_generator():
        try:
            # Initial replay of missed events
            if last_event_id:
                events = await sse_manager.get_events_since(last_event_id, subscribed_types)
                for event in events:
                    yield _format_sse_event(event)
            
            # Subscribe to new events
            async for event in sse_manager.subscribe(client_id, subscribed_types):
                yield _format_sse_event(event)
                
                # Update client's last event ID
                async with sse_manager._lock:
                    if client_id in sse_manager._clients:
                        sse_manager._clients[client_id].last_event_id = event.get('event_id')
                        sse_manager._clients[client_id].last_sent_at = time.time()
                        
        except asyncio.CancelledError:
            # Client disconnected
            await sse_manager.disconnect(client_id)
        except Exception as e:
            # Other error
            await sse_manager.disconnect(client_id)
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


def _format_sse_event(event: Dict[str, Any]) -> str:
    """Format an event as SSE format."""
    lines = []
    
    if event.get('event_id'):
        lines.append(f"id: {event['event_id']}")
    
    if event.get('event_type'):
        lines.append(f"event: {event['event_type']}")
    
    if event.get('retry') is not None:
        lines.append(f"retry: {event['retry']}")
    
    # Data as JSON
    data_json = json.dumps(event.get('data', {}))
    lines.append(f"data: {data_json}")
    
    lines.append("")  # Empty line to end the event
    
    return "\n".join(lines)


# Convenience functions for common use cases

async def broadcast_message(message: str, event_type: str = "message") -> str:
    """Broadcast a simple message to all clients."""
    return await sse_manager.broadcast(event_type, {"message": message})


async def broadcast_update(data: Dict[str, Any], event_type: str = "update") -> str:
    """Broadcast an update to all clients."""
    return await sse_manager.broadcast(event_type, data)


async def send_to_client(client_id: str, data: Dict[str, Any], event_type: str = "message") -> bool:
    """Send data to a specific client."""
    return await sse_manager.broadcast_to_client(client_id, event_type, data)


# Startup/shutdown handlers for FastAPI

async def sse_startup():
    """Startup handler to start SSE manager."""
    await sse_manager.start()


async def sse_shutdown():
    """Shutdown handler to stop SSE manager."""
    await sse_manager.stop()
