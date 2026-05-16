"""SSEManager with broadcast, disconnect detection, and concurrency safety"""
import asyncio
import uuid
from typing import Optional, Set, List, Callable, Awaitable

class SSEManager:
    def __init__(self):
        self._lock = asyncio.Lock()
        self._clients: dict = {}

    async def connect(self, event_types: Optional[List[str]] = None) -> str:
        async with self._lock:
            client_id = str(uuid.uuid4())
            self._clients[client_id] = {
                "queue": asyncio.Queue(),
                "event_types": event_types or [],
                "connected_at": asyncio.get_event_loop().time(),
            }
            return client_id

    async def disconnect(self, client_id: str):
        async with self._lock:
            if client_id in self._clients:
                del self._clients[client_id]

    async def broadcast(self, data: str, event: str = "message") -> int:
        sent = 0
        async with self._lock:
            client_ids = list(self._clients.keys())
        for cid in client_ids:
            client = self._clients.get(cid)
            if client and (not client["event_types"] or event in client["event_types"]):
                try:
                    await client["queue"].put({"event": event, "data": data})
                    sent += 1
                except Exception:
                    pass
        return sent

    async def connection_count(self) -> int:
        async with self._lock:
            return len(self._clients)

    async def get_connections(self, event_type: Optional[str] = None) -> List[str]:
        async with self._lock:
            if event_type:
                return [cid for cid, c in self._clients.items() if event_type in c.get("event_types", [])]
            return list(self._clients.keys())

    async def cleanup_stale(self, max_age: float = 300):
        async with self._lock:
            now = asyncio.get_event_loop().time()
            stale = [cid for cid, c in self._clients.items() if now - c["connected_at"] > max_age]
            for cid in stale:
                del self._clients[cid]
