import asyncio
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketState


@pytest.mark.anyio
async def test_websocket_init_without_ping_interval():
    """Test that WebSocket can be created without ping_interval."""
    websocket = WebSocket(
        scope={"type": "websocket"},
        receive=AsyncMock(),
        send=AsyncMock(),
    )
    assert websocket.ping_interval is None
    assert websocket._heartbeat_task is None


@pytest.mark.anyio
async def test_websocket_init_with_ping_interval():
    """Test that WebSocket stores ping_interval from constructor."""
    websocket = WebSocket(
        scope={"type": "websocket"},
        receive=AsyncMock(),
        send=AsyncMock(),
        ping_interval=30,
    )
    assert websocket.ping_interval == 30
    assert websocket._heartbeat_task is None


@pytest.mark.anyio
async def test_websocket_heartbeat_sends_pings():
    """Test that heartbeat sends ping frames at the configured interval."""
    received_messages: list[dict] = []

    async def tracking_send(message: dict) -> None:
        received_messages.append(message)

    websocket = WebSocket(
        scope={"type": "websocket"},
        receive=AsyncMock(),
        send=tracking_send,
        ping_interval=0.05,
    )

    # Manually set states so we can start the heartbeat without a real ASGI connection
    websocket.client_state = WebSocketState.CONNECTED
    websocket.application_state = WebSocketState.CONNECTED

    # Start heartbeat manually
    websocket.start_heartbeat()
    assert websocket._heartbeat_task is not None

    # Give it time to send pings
    await asyncio.sleep(0.12)

    # Cancel heartbeat
    websocket._heartbeat_task.cancel()

    # Check that pings were sent
    ping_messages = [m for m in received_messages if m.get("type") == "websocket.ping"]
    assert len(ping_messages) >= 1, f"Expected at least 1 ping, got {len(ping_messages)}"


@pytest.mark.anyio
async def test_websocket_heartbeat_cancelled_on_close():
    """Test that heartbeat task is cancelled when websocket is closed."""
    mock_send = AsyncMock()
    websocket = WebSocket(
        scope={"type": "websocket"},
        receive=AsyncMock(),
        send=mock_send,
        ping_interval=30,
    )

    websocket.client_state = WebSocketState.CONNECTED
    websocket.application_state = WebSocketState.CONNECTED

    websocket.start_heartbeat()
    assert websocket._heartbeat_task is not None
    task = websocket._heartbeat_task
    assert not task.done()

    await websocket.close()
    # Give event loop a moment to process cancellation
    await asyncio.sleep(0.01)
    assert task.cancelled()


@pytest.mark.anyio
async def test_websocket_start_heartbeat_updates_interval():
    """Test that start_heartbeat can update the ping interval."""
    mock_send = AsyncMock()
    websocket = WebSocket(
        scope={"type": "websocket"},
        receive=AsyncMock(),
        send=mock_send,
    )

    websocket.start_heartbeat(interval=10)
    assert websocket.ping_interval == 10
    assert websocket._heartbeat_task is not None
    websocket._heartbeat_task.cancel()


def test_websocket_receive_text_with_testclient():
    """Integration test: test WebSocket via TestClient."""
    app = FastAPI()

    @app.websocket("/ws")
    async def ws_endpoint(websocket: WebSocket):
        await websocket.accept()
        data = await websocket.receive_text()
        await websocket.send_text(f"Echo: {data}")
        await websocket.close()

    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        ws.send_text("hello")
        response = ws.receive_text()
        assert response == "Echo: hello"
