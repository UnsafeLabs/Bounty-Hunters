"""SSEManager with Last-Event-ID replay and retry"""
import asyncio, json, time as _time
from typing import Dict, List, Optional, Set
from dataclasses import dataclass, field

@dataclass
class SSEConnection:
    queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    last_event_id: Optional[str] = None
    connected_at: float = field(default_factory=_time.time)
    subscribed_events: Set[str] = field(default_factory=set)

class SSEManager:
    def __init__(self, max_age: int = 300):
        self._connections: Dict[str, SSEConnection] = {}
        self._lock = asyncio.Lock()
        self._event_log: List[dict] = []
        self._max_age = max_age

    async def connect(self, client_id: str, last_event_id: Optional[str] = None) -> SSEConnection:
        async with self._lock:
            conn = SSEConnection(last_event_id=last_event_id)
            self._connections[client_id] = conn
        if last_event_id:
            for evt in self._event_log:
                if evt.get("id", "") > last_event_id:
                    await conn.queue.put(evt)
        return conn

    async def disconnect(self, client_id: str) -> None:
        async with self._lock:
            self._connections.pop(client_id, None)

    async def broadcast(self, data: str, event_type: Optional[str] = None, retry: Optional[int] = None) -> None:
        event = {"id": str(int(_time.time() * 1000)), "data": data, "timestamp": _time.time()}
        if event_type: event["event"] = event_type
        if retry is not None: event["retry"] = retry
        self._event_log.append(event)
        if len(self._event_log) > 1000: self._event_log = self._event_log[-500:]
        async with self._lock:
            for conn in self._connections.values():
                if not event_type or event_type in conn.subscribed_events:
                    await conn.queue.put(event)

    async def get_connections(self, event_type: Optional[str] = None) -> List[str]:
        async with self._lock:
            if event_type:
                return [cid for cid, conn in self._connections.items() if event_type in conn.subscribed_events]
            return list(self._connections.keys())

    async def cleanup_stale(self) -> int:
        removed = 0; now = _time.time()
        async with self._lock:
            stale = [cid for cid, c in self._connections.items() if now - c.connected_at > self._max_age]
            for cid in stale: del self._connections[cid]
        return len(stale)
