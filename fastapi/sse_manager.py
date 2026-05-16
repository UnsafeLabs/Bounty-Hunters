"""SSEManager with asyncio.Lock concurrency safety"""
import asyncio, uuid, time
from typing import Optional, List

class SSEManager:
    def __init__(self):
        self._lock = asyncio.Lock()
        self._clients = {}

    async def connect(self, event_types=None):
        async with self._lock:
            cid = str(uuid.uuid4())
            self._clients[cid] = {"queue": asyncio.Queue(), "event_types": event_types or [], "ts": asyncio.get_event_loop().time()}
            return cid

    async def disconnect(self, cid):
        async with self._lock:
            if cid in self._clients: del self._clients[cid]

    async def broadcast(self, data, event="message"):
        sent = 0
        async with self._lock: cids = list(self._clients.keys())
        for cid in cids:
            c = self._clients.get(cid)
            if c and (not c["event_types"] or event in c["event_types"]):
                try:
                    await c["queue"].put({"event": event, "data": data})
                    sent += 1
                except: pass
        return sent

    async def connection_count(self):
        async with self._lock: return len(self._clients)

    async def get_connections(self, event_type=None):
        async with self._lock:
            if event_type: return [cid for cid, c in self._clients.items() if event_type in c.get("event_types", [])]
            return list(self._clients.keys())

    async def cleanup_stale(self, max_age=300):
        async with self._lock:
            now = asyncio.get_event_loop().time()
            stale = [cid for cid, c in self._clients.items() if now - c["ts"] > max_age]
            for cid in stale: del self._clients[cid]
