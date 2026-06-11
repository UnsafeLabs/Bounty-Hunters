import asyncio

import pytest
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, WebSocketWithHeartbeat
from fastapi.testclient import TestClient

app = FastAPI()
disconnect_events: list[tuple[int, float]] = []


def record_disconnect(code: int, duration: float) -> None:
    disconnect_events.append((code, duration))


@app.websocket("/heartbeat")
async def heartbeat_endpoint(websocket: WebSocket):
    heartbeat = WebSocketWithHeartbeat(
        websocket,
        ping_interval=0.01,
        pong_timeout=0.5,
        on_disconnect=record_disconnect,
    )
    await heartbeat.accept()
    message = await heartbeat.receive_text()
    await heartbeat.send_json(
        {
            "message": message,
            "message_count": heartbeat.message_count,
            "has_duration": heartbeat.connection_duration > 0,
        }
    )
    await heartbeat.close()


@app.websocket("/heartbeat-timeout")
async def heartbeat_timeout_endpoint(websocket: WebSocket):
    heartbeat = WebSocketWithHeartbeat(
        websocket,
        ping_interval=0.01,
        pong_timeout=0.02,
        on_disconnect=record_disconnect,
    )
    await heartbeat.accept()
    await asyncio.sleep(0.08)


@app.websocket("/plain")
async def plain_websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    await websocket.send_text("plain")
    await websocket.close()


client = TestClient(app)


def test_websocket_with_heartbeat_sends_ping_and_tracks_messages():
    disconnect_events.clear()

    with client.websocket_connect("/heartbeat") as websocket:
        assert websocket.receive_text() == "__fastapi_ping__"
        websocket.send_text("__fastapi_pong__")
        websocket.send_text("payload")
        assert websocket.receive_json() == {
            "message": "payload",
            "message_count": 1,
            "has_duration": True,
        }

    assert disconnect_events
    code, duration = disconnect_events[-1]
    assert code == 1000
    assert duration > 0


def test_websocket_with_heartbeat_closes_when_pong_times_out():
    disconnect_events.clear()

    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect("/heartbeat-timeout") as websocket:
            assert websocket.receive_text() == "__fastapi_ping__"
            websocket.receive_text()

    assert exc_info.value.code == 1001
    assert disconnect_events
    code, duration = disconnect_events[-1]
    assert code == 1001
    assert duration > 0


def test_websocket_without_heartbeat_still_works():
    with client.websocket_connect("/plain") as websocket:
        assert websocket.receive_text() == "plain"
