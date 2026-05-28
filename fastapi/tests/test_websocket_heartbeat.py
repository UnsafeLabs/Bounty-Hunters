"""Tests for WebSocketWithHeartbeat."""
import asyncio
from unittest.mock import AsyncMock

import anyio
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from fastapi.websockets import WebSocket, WebSocketState, WebSocketWithHeartbeat


class TestWebSocketWithHeartbeatProperties:
    """Test connection_duration and message_count properties."""

    def test_connection_duration_before_accept(self):
        """connection_duration returns 0 before accept."""
        ws = WebSocketWithHeartbeat(
            scope={"type": "websocket"},
            receive=AsyncMock(),
            send=AsyncMock(),
        )
        assert ws.connection_duration == 0.0

    def test_message_count_initial(self):
        """message_count starts at 0."""
        ws = WebSocketWithHeartbeat(
            scope={"type": "websocket"},
            receive=AsyncMock(),
            send=AsyncMock(),
        )
        assert ws.message_count == 0

    def test_default_ping_interval(self):
        """Default ping_interval is 30 seconds."""
        ws = WebSocketWithHeartbeat(
            scope={"type": "websocket"},
            receive=AsyncMock(),
            send=AsyncMock(),
        )
        assert ws.ping_interval == 30.0

    def test_default_pong_timeout(self):
        """Default pong_timeout is 10 seconds."""
        ws = WebSocketWithHeartbeat(
            scope={"type": "websocket"},
            receive=AsyncMock(),
            send=AsyncMock(),
        )
        assert ws.pong_timeout == 10.0

    def test_custom_intervals(self):
        """Custom ping_interval and pong_timeout are stored."""
        ws = WebSocketWithHeartbeat(
            scope={"type": "websocket"},
            receive=AsyncMock(),
            send=AsyncMock(),
            ping_interval=5.0,
            pong_timeout=2.0,
        )
        assert ws.ping_interval == 5.0
        assert ws.pong_timeout == 2.0

    def test_on_disconnect_callback_stored(self):
        """on_disconnect callback is stored."""
        cb = AsyncMock()
        ws = WebSocketWithHeartbeat(
            scope={"type": "websocket"},
            receive=AsyncMock(),
            send=AsyncMock(),
            on_disconnect=cb,
        )
        assert ws.on_disconnect is cb

    def test_no_on_disconnect_by_default(self):
        """on_disconnect is None by default."""
        ws = WebSocketWithHeartbeat(
            scope={"type": "websocket"},
            receive=AsyncMock(),
            send=AsyncMock(),
        )
        assert ws.on_disconnect is None


class TestWebSocketInheritance:
    """Test that WebSocketWithHeartbeat preserves WebSocket behavior."""

    def test_is_websocket_subclass(self):
        """WebSocketWithHeartbeat is a subclass of WebSocket."""
        assert issubclass(WebSocketWithHeartbeat, WebSocket)

    def test_websocket_without_heartbeat_still_works(self):
        """Regular WebSocket connections work unchanged."""
        app = FastAPI()

        @app.websocket("/ws")
        async def ws_endpoint(ws: WebSocket):
            await ws.accept()
            data = await ws.receive_text()
            await ws.send_text(f"echo: {data}")

        client = TestClient(app)
        with client.websocket_connect("/ws") as ws:
            ws.send_text("hello")
            result = ws.receive_text()
            assert result == "echo: hello"
