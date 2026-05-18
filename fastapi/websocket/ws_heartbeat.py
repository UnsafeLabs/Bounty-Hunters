"""Fix: Add WebSocket heartbeat with configurable ping interval (#766)

Problem: WebSocket connections silently drop without detection.
No keepalive mechanism.

Solution: Configurable ping/pong heartbeat, connection
liveness tracking, and automatic cleanup.
"""

import asyncio
import time
from typing import Optional, Callable
from dataclasses import dataclass

from fastapi import WebSocket


@dataclass
class HeartbeatConfig:
    ping_interval: float = 30.0      # seconds between pings
    pong_timeout: float = 10.0       # seconds to wait for pong
    max_missed_pongs: int = 3        # disconnect after N missed
    ping_message: str = "ping"
    expected_pong: str = "pong"


class WebSocketHeartbeat:
    def __init__(self, config: Optional[HeartbeatConfig] = None):
        self.config = config or HeartbeatConfig()
        self._connections: dict[str, dict] = {}

    async def wrap(self, websocket: WebSocket, on_message: Optional[Callable] = None) -> None:
        conn_id = id(websocket)
        self._connections[conn_id] = {
            "ws": websocket,
            "last_pong": time.time(),
            "missed_pongs": 0,
            "alive": True,
        }

        try:
            await asyncio.gather(
                self._ping_loop(conn_id),
                self._receive_loop(conn_id, on_message),
            )
        except Exception:
            pass
        finally:
            self._connections.pop(conn_id, None)

    async def _ping_loop(self, conn_id: str) -> None:
        conn = self._connections.get(conn_id)
        if not conn:
            return

        ws = conn["ws"]

        while conn.get("alive"):
            await asyncio.sleep(self.config.ping_interval)

            try:
                await ws.send_text(self.config.ping_message)
                
                # Check if previous pong was received
                if time.time() - conn["last_pong"] > self.config.ping_interval + self.config.pong_timeout:
                    conn["missed_pongs"] += 1
                    
                    if conn["missed_pongs"] >= self.config.max_missed_pongs:
                        conn["alive"] = False
                        await ws.close(code=1000, reason="Heartbeat timeout")
                        return
            except Exception:
                conn["alive"] = False
                return

    async def _receive_loop(self, conn_id: str, on_message: Optional[Callable] = None) -> None:
        conn = self._connections.get(conn_id)
        if not conn:
            return

        ws = conn["ws"]

        while conn.get("alive"):
            try:
                data = await asyncio.wait_for(
                    ws.receive_text(),
                    timeout=self.config.ping_interval + self.config.pong_timeout,
                )

                if data == self.config.expected_pong:
                    conn["last_pong"] = time.time()
                    conn["missed_pongs"] = 0
                elif on_message:
                    await on_message(ws, data)
                    
            except asyncio.TimeoutError:
                conn["missed_pongs"] += 1
                if conn["missed_pongs"] >= self.config.max_missed_pongs:
                    conn["alive"] = False
                    try:
                        await ws.close(code=1000, reason="Pong timeout")
                    except Exception:
                        pass
                    return
            except Exception:
                conn["alive"] = False
                return

    def get_connection_stats(self) -> dict:
        return {
            "total": len(self._connections),
            "alive": sum(1 for c in self._connections.values() if c.get("alive")),
        }
