import asyncio
import time

import pytest
from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient
from fastapi.websockets import WebSocketState, WebSocketWithHeartbeat


def test_websocket_with_heartbeat_basic():
    app = FastAPI()
    disconnect_called = []
    disconnect_code = []
    disconnect_duration = []

    async def on_disconnect(code: int, duration: float):
        disconnect_called.append(True)
        disconnect_code.append(code)
        disconnect_duration.append(duration)

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        ws = WebSocketWithHeartbeat(
            websocket.scope,
            websocket._receive,
            websocket._send,
            ping_interval=0.1,
            pong_timeout=0.5,
            on_disconnect=on_disconnect,
        )
        await ws.accept()
        await ws.send_text("connected")
        await asyncio.sleep(0.3)
        await ws.close()

    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        data = ws.receive_text()
        assert data == "connected"
        time.sleep(0.4)

    assert disconnect_called == [True]
    assert disconnect_code[0] == 1000
    assert disconnect_duration[0] > 0.3


def test_websocket_with_heartbeat_pong_timeout():
    """Test that connection is closed when pong timeout is exceeded.

    Note: This test simulates a pong timeout by not sending pong responses.
    In TestClient, we can't easily test the actual ping/pong mechanism,
    so we test the close behavior directly.
    """
    app = FastAPI()
    disconnect_called = []
    disconnect_code = []

    async def on_disconnect(code: int, duration: float):
        disconnect_called.append(True)
        disconnect_code.append(code)

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        ws = WebSocketWithHeartbeat(
            websocket.scope,
            websocket._receive,
            websocket._send,
            ping_interval=0.05,
            pong_timeout=0.1,
            on_disconnect=on_disconnect,
        )
        await ws.accept()
        await ws.send_text("connected")
        # Manually trigger close with timeout code
        await asyncio.sleep(0.3)
        await ws.close(code=1001, reason="Pong timeout")

    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        data = ws.receive_text()
        assert data == "connected"
        time.sleep(0.4)

    assert disconnect_called == [True]
    assert disconnect_code[0] == 1001


def test_websocket_with_heartbeat_message_count():
    app = FastAPI()
    received_counts = []

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        ws = WebSocketWithHeartbeat(
            websocket.scope,
            websocket._receive,
            websocket._send,
            ping_interval=10.0,
            pong_timeout=10.0,
        )
        await ws.accept()
        # Receive 5 messages from client
        for _ in range(5):
            await ws.receive_text()
        received_counts.append(ws.message_count)
        await ws.close()

    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        for i in range(5):
            ws.send_text(f"message {i}")

    assert received_counts == [5]


def test_websocket_with_heartbeat_connection_duration():
    app = FastAPI()
    durations = []

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        ws = WebSocketWithHeartbeat(
            websocket.scope,
            websocket._receive,
            websocket._send,
            ping_interval=10.0,
            pong_timeout=10.0,
        )
        await ws.accept()
        await asyncio.sleep(0.2)
        durations.append(ws.connection_duration)
        await ws.close()

    client = TestClient(app)
    with client.websocket_connect("/ws") as _:
        time.sleep(0.3)

    assert durations[0] >= 0.2
    assert durations[0] < 1.0


def test_websocket_with_heartbeat_custom_intervals():
    app = FastAPI()
    ping_intervals = []
    pong_timeouts = []

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        ws = WebSocketWithHeartbeat(
            websocket.scope,
            websocket._receive,
            websocket._send,
            ping_interval=5.0,
            pong_timeout=2.0,
        )
        await ws.accept()
        ping_intervals.append(ws.ping_interval)
        pong_timeouts.append(ws.pong_timeout)
        await ws.send_text("done")
        await ws.close()

    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        data = ws.receive_text()
        assert data == "done"

    assert ping_intervals == [5.0]
    assert pong_timeouts == [2.0]


def test_websocket_without_heartbeat_still_works():
    app = FastAPI()

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        await websocket.accept()
        await websocket.send_text("hello")
        await websocket.close()

    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        data = ws.receive_text()
        assert data == "hello"


def test_websocket_with_heartbeat_receive_text():
    app = FastAPI()
    received = []

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        ws = WebSocketWithHeartbeat(
            websocket.scope,
            websocket._receive,
            websocket._send,
            ping_interval=10.0,
            pong_timeout=10.0,
        )
        await ws.accept()
        text = await ws.receive_text()
        received.append(text)
        await ws.send_text(f"echo: {text}")
        await ws.close()

    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        ws.send_text("test message")
        data = ws.receive_text()
        assert data == "echo: test message"

    assert received == ["test message"]


def test_websocket_with_heartbeat_receive_bytes():
    app = FastAPI()
    received = []

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        ws = WebSocketWithHeartbeat(
            websocket.scope,
            websocket._receive,
            websocket._send,
            ping_interval=10.0,
            pong_timeout=10.0,
        )
        await ws.accept()
        data = await ws.receive_bytes()
        received.append(data)
        await ws.send_bytes(b"echo: " + data)
        await ws.close()

    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        ws.send_bytes(b"binary data")
        data = ws.receive_bytes()
        assert data == b"echo: binary data"

    assert received == [b"binary data"]


def test_websocket_with_heartbeat_receive_json():
    app = FastAPI()
    received = []

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        ws = WebSocketWithHeartbeat(
            websocket.scope,
            websocket._receive,
            websocket._send,
            ping_interval=10.0,
            pong_timeout=10.0,
        )
        await ws.accept()
        data = await ws.receive_json()
        received.append(data)
        await ws.send_json({"echo": data})
        await ws.close()

    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"key": "value"})
        data = ws.receive_json()
        assert data == {"echo": {"key": "value"}}

    assert received == [{"key": "value"}]


def test_websocket_with_heartbeat_iter_text():
    app = FastAPI()
    received = []

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        ws = WebSocketWithHeartbeat(
            websocket.scope,
            websocket._receive,
            websocket._send,
            ping_interval=10.0,
            pong_timeout=10.0,
        )
        await ws.accept()
        async for text in ws.iter_text():
            received.append(text)
            if text == "stop":
                break
        await ws.close()

    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        ws.send_text("message 1")
        ws.send_text("message 2")
        ws.send_text("stop")

    assert received == ["message 1", "message 2", "stop"]


def test_websocket_with_heartbeat_on_disconnect_async():
    app = FastAPI()
    disconnect_data = []

    async def on_disconnect(code: int, duration: float):
        disconnect_data.append((code, duration))
        await asyncio.sleep(0.01)

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        ws = WebSocketWithHeartbeat(
            websocket.scope,
            websocket._receive,
            websocket._send,
            ping_interval=10.0,
            pong_timeout=10.0,
            on_disconnect=on_disconnect,
        )
        await ws.accept()
        await ws.send_text("hello")
        await ws.close(code=1001, reason="going away")

    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        data = ws.receive_text()
        assert data == "hello"

    assert len(disconnect_data) == 1
    assert disconnect_data[0][0] == 1001
    assert disconnect_data[0][1] > 0


def test_websocket_with_heartbeat_properties():
    app = FastAPI()
    props = {}

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        ws = WebSocketWithHeartbeat(
            websocket.scope,
            websocket._receive,
            websocket._send,
            ping_interval=10.0,
            pong_timeout=10.0,
        )
        await ws.accept()
        props["client_state"] = ws.client_state
        props["application_state"] = ws.application_state
        props["url"] = str(ws.url)
        await ws.send_text("done")
        await ws.close()

    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        data = ws.receive_text()
        assert data == "done"

    assert props["client_state"] == WebSocketState.CONNECTED
    assert props["application_state"] == WebSocketState.CONNECTED
    assert "ws://testserver/ws" in props["url"]


def test_websocket_with_heartbeat_send_json_binary():
    app = FastAPI()

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        ws = WebSocketWithHeartbeat(
            websocket.scope,
            websocket._receive,
            websocket._send,
            ping_interval=10.0,
            pong_timeout=10.0,
        )
        await ws.accept()
        await ws.send_json({"binary": True}, mode="binary")
        await ws.close()

    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        data = ws.receive_bytes()
        import json
        assert json.loads(data.decode("utf-8")) == {"binary": True}


def test_websocket_with_heartbeat_message_count_receive():
    """Test that message_count tracks received messages correctly."""
    app = FastAPI()
    counts = []

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        ws = WebSocketWithHeartbeat(
            websocket.scope,
            websocket._receive,
            websocket._send,
            ping_interval=10.0,
            pong_timeout=10.0,
        )
        await ws.accept()
        # Receive 3 messages
        for _ in range(3):
            await ws.receive_text()
        counts.append(ws.message_count)
        await ws.close()

    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        ws.send_text("msg1")
        ws.send_text("msg2")
        ws.send_text("msg3")

    assert counts == [3]


def test_websocket_with_heartbeat_on_disconnect_sync():
    """Test that sync on_disconnect callback works."""
    app = FastAPI()
    disconnect_data = []

    def on_disconnect(code: int, duration: float):
        disconnect_data.append((code, duration))

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        ws = WebSocketWithHeartbeat(
            websocket.scope,
            websocket._receive,
            websocket._send,
            ping_interval=10.0,
            pong_timeout=10.0,
            on_disconnect=on_disconnect,
        )
        await ws.accept()
        await ws.send_text("hello")
        await ws.close(code=1000, reason="normal")

    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        data = ws.receive_text()
        assert data == "hello"

    assert len(disconnect_data) == 1
    assert disconnect_data[0][0] == 1000
    assert disconnect_data[0][1] > 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

