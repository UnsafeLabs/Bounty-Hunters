from __future__ import annotations

import asyncio
import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from fastapi import FastAPI, WebSocket


class TestWebSocketWithHeartbeat:
    def test_rapid_connect_disconnect_cycles(self):
        app = FastAPI()
        connected = []

        @app.websocket("/ws")
        async def ws_endpoint(websocket: WebSocket):
            from fastapi.websockets import WebSocketWithHeartbeat
            ws = WebSocketWithHeartbeat(websocket, heartbeat_interval=0.1)
            await ws.accept()
            connected.append(True)

        client = TestClient(app)
        for _ in range(10):
            with client.websocket_connect("/ws") as ws:
                pass
        assert len(connected) == 10

    def test_heartbeat_pong_response(self):
        app = FastAPI()

        @app.websocket("/ws")
        async def ws_endpoint(websocket: WebSocket):
            from fastapi.websockets import WebSocketWithHeartbeat
            ws = WebSocketWithHeartbeat(websocket, heartbeat_interval=0.05, heartbeat_timeout=0.3)
            await ws.accept()

        client = TestClient(app)
        with client.websocket_connect("/ws") as ws:
            import time
            start = time.monotonic()
            while time.monotonic() - start < 0.5:
                try:
                    data = ws.receive_json()
                    if data.get("type") == "ping":
                        ws.send_json({"type": "pong"})
                    else:
                        ws.send_json({"type": "ack"})
                except WebSocketDisconnect:
                    break

    def test_connect_count_increments(self):
        from fastapi.websockets import WebSocketWithHeartbeat
        app = FastAPI()
        heartbeat_refs = []

        @app.websocket("/ws")
        async def ws_endpoint(websocket: WebSocket):
            ws = WebSocketWithHeartbeat(websocket)
            await ws.accept()
            heartbeat_refs.append(ws.connect_count)

        client = TestClient(app)
        with client.websocket_connect("/ws"):
            pass
        assert heartbeat_refs == [1]

    def test_edge_case_empty_payload(self):
        app = FastAPI()

        @app.websocket("/ws")
        async def ws_endpoint(websocket: WebSocket):
            from fastapi.websockets import WebSocketWithHeartbeat
            ws = WebSocketWithHeartbeat(websocket, heartbeat_interval=0.05)
            await ws.accept()
            # rapid cycles won't crash
            try:
                for _ in range(5):
                    await asyncio.sleep(0.02)
            except Exception:
                pass

        client = TestClient(app)
        with client.websocket_connect("/ws"):
            pass
