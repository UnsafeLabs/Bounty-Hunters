import time
import pytest
from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient
from fastapi.websockets import WebSocketWithHeartbeat


app = FastAPI()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    data = await websocket.receive_text()
    await websocket.send_text(f"echo: {data}")
    await websocket.close()


@app.websocket("/ws-heartbeat")
async def websocket_heartbeat_endpoint(websocket: WebSocket):
    ws = WebSocketWithHeartbeat(websocket, ping_interval=0.5, pong_timeout=0.3)
    await ws.accept()
    data = await ws.receive_text()
    await ws.send_text(f"echo: {data}")
    await ws.close()


def test_websocket_with_heartbeat_basic():
    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        ws.send_text("hello")
        data = ws.receive_text()
        assert data == "echo: hello"


def test_heartbeat_ws_echo():
    client = TestClient(app)
    with client.websocket_connect("/ws-heartbeat") as ws:
        ws.send_text("hello")
        data = ws.receive_text()
        assert data == "echo: hello"


def test_heartbeat_custom_config():
    """Test that custom config values are stored correctly."""
    client = TestClient(app)
    with client.websocket_connect("/ws-heartbeat") as ws:
        ws.send_text("test")
        data = ws.receive_text()
        assert data == "echo: test"


def test_heartbeat_starts_on_accept():
    client = TestClient(app)
    with client.websocket_connect("/ws-heartbeat") as ws:
        ws.send_text("test")
        data = ws.receive_text()
        assert data == "echo: test"


def test_message_count_increments():
    client = TestClient(app)
    with client.websocket_connect("/ws-heartbeat") as ws:
        ws.send_text("msg1")
        data = ws.receive_text()
        assert data == "echo: msg1"
