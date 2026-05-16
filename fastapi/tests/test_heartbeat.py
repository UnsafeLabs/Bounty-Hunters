"""Tests for WebSocketWithHeartbeat configuration."""
import time
from unittest.mock import AsyncMock, MagicMock, PropertyMock, patch

import pytest
from starlette.websockets import WebSocket

from fastapi.websockets import WebSocketWithHeartbeat


def test_websocket_with_heartbeat_init():
    """WebSocketWithHeartbeat stores config params."""
    ws = MagicMock(spec=WebSocket)
    hb = WebSocketWithHeartbeat(
        ws,
        ping_interval=15.0,
        pong_timeout=5.0,
        on_disconnect=lambda code, dur: None,
    )
    assert hb._ping_interval == 15.0
    assert hb._pong_timeout == 5.0
    assert hb._on_disconnect is not None
    assert hb._message_count == 0
    assert hb._running is True


def test_websocket_connection_duration():
    """connection_duration increases over time."""
    ws = MagicMock(spec=WebSocket)
    hb = WebSocketWithHeartbeat(ws)
    d1 = hb.connection_duration
    time.sleep(0.01)
    d2 = hb.connection_duration
    assert d2 > d1


def test_websocket_message_count():
    """message_count increments on sends and receives."""
    ws = MagicMock(spec=WebSocket)
    ws._receive = AsyncMock(return_value={"type": "websocket.receive", "text": "hello"})
    ws.receive_text = AsyncMock(return_value="hello")

    hb = WebSocketWithHeartbeat(ws)
    import asyncio
    msg = asyncio.run(hb.receive())
    assert hb.message_count == 1


def test_default_params():
    """Default ping_interval=30, pong_timeout=10."""
    ws = MagicMock(spec=WebSocket)
    hb = WebSocketWithHeartbeat(ws)
    assert hb._ping_interval == 30.0
    assert hb._pong_timeout == 10.0


def test_close_sets_code():
    """close() sets the close_code property."""
    ws = MagicMock(spec=WebSocket)
    ws.close = AsyncMock()
    hb = WebSocketWithHeartbeat(ws)
    import asyncio
    asyncio.run(hb.close(code=1001))
    assert hb.close_code == 1001
