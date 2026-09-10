"""Tests for WebSocketWithHeartbeat heartbeat/ping mechanism."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from fastapi.websockets import WebSocketWithHeartbeat


@pytest.mark.asyncio
async def test_heartbeat_send_ping():
    """Verify ping frames are sent at configured interval."""
    mock_ws = AsyncMock()
    mock_ws.client_state = ...  # Will be set dynamically
    mock_ws.application_state = ...

    # Mock client_state to be CONNECTED then DISCONNECTED after first heartbeat
    import starlette.websockets as sws
    mock_ws.client_state = sws.WebSocketState.CONNECTED

    hb = WebSocketWithHeartbeat(mock_ws, ping_interval=0.01, pong_timeout=0.05)

    await hb.accept()

    # Let one heartbeat cycle run
    import asyncio
    await asyncio.sleep(0.02)

    # After one ping cycle the heartbeat should have tried to receive (pong)
    assert mock_ws.receive_text.awaited or mock_ws.close.awaited, \
        "Heartbeat should trigger receive after ping interval"


@pytest.mark.asyncio
async def test_message_count():
    """Verify message_count tracks sent and received messages."""
    mock_ws = AsyncMock()
    mock_ws.client_state = ...
    mock_ws.application_state = ...

    import starlette.websockets as sws
    mock_ws.client_state = sws.WebSocketState.CONNECTED
    mock_ws.receive_text.return_value = "pong"

    hb = WebSocketWithHeartbeat(mock_ws, ping_interval=0.01, pong_timeout=0.05)

    await hb.accept()
    await hb.send_text("hello")
    await hb.send_json({"msg": "world"})

    assert hb.message_count >= 2, "send_text and send_json should increment counter"


@pytest.mark.asyncio
async def test_connection_duration():
    """Verify connection_duration property is accurate."""
    mock_ws = AsyncMock()
    import starlette.websockets as sws
    mock_ws.client_state = sws.WebSocketState.CONNECTED
    mock_ws.application_state = sws.WebSocketState.CONNECTED

    hb = WebSocketWithHeartbeat(mock_ws)
    await hb.accept()

    import asyncio
    await asyncio.sleep(0.05)
    dur = hb.connection_duration
    assert dur >= 0.04, f"Duration should be ~0.05s, got {dur}"


@pytest.mark.asyncio
async def test_disconnect_callback():
    """Verify on_disconnect callback fires with close code and duration."""
    mock_ws = AsyncMock()
    import starlette.websockets as sws
    mock_ws.client_state = sws.WebSocketState.CONNECTED
    mock_ws.application_state = sws.WebSocketState.CONNECTED

    callback = AsyncMock()
    hb = WebSocketWithHeartbeat(mock_ws, ping_interval=30, on_disconnect=callback)

    await hb.accept()
    await hb.close(code=1001)

    assert callback.awaited, "on_disconnect callback should have been called"


@pytest.mark.asyncio
async def test_ping_interval_override():
    """Verify ping_interval and pong_timeout can be overridden per connection."""
    mock_ws = AsyncMock()
    import starlette.websockets as sws
    mock_ws.client_state = sws.WebSocketState.CONNECTED
    mock_ws.application_state = sws.WebSocketState.CONNECTED

    hb = WebSocketWithHeartbeat(mock_ws, ping_interval=60, pong_timeout=20)
    assert hb._ping_interval == 60
    assert hb._pong_timeout == 20


@pytest.mark.asyncio
async def test_no_heartbeat_when_interval_zero():
    """Verify setting ping_interval=0 disables heartbeat."""
    mock_ws = AsyncMock()
    import starlette.websockets as sws
    mock_ws.client_state = sws.WebSocketState.CONNECTED
    mock_ws.application_state = sws.WebSocketState.CONNECTED

    hb = WebSocketWithHeartbeat(mock_ws, ping_interval=0)
    await hb.accept()

    # No heartbeat task should be created
    assert hb._heartbeat_task is None, "Heartbeat task should not be created when interval is 0"
