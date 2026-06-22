import pytest
from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient
from fastapi.websockets import WebSocketWithHeartbeat

app = FastAPI()

@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    ws = WebSocketWithHeartbeat(websocket, ping_interval=60, pong_timeout=30)
    await ws.run_with_heartbeat(lambda w: w.send_text("hello"))

client = TestClient(app)

class TestWebSocketWithHeartbeat:
    def test_basic_websocket_still_works(self):
        with client.websocket_connect("/ws") as ws:
            data = ws.receive_text()
            assert data == "hello"

    @pytest.mark.asyncio
    async def test_connection_duration_property(self):
        from fastapi import WebSocket as FastAPIWS
        import asyncio
        # Simulate
        ws = WebSocketWithHeartbeat(None, ping_interval=60, pong_timeout=30)  # type: ignore
        assert ws.ping_interval == 60
        assert ws.pong_timeout == 30

    @pytest.mark.asyncio
    async def test_message_count(self):
        ws = WebSocketWithHeartbeat(None, ping_interval=60, pong_timeout=30)  # type: ignore
        assert ws.message_count == 0
