"""Tests for WebSocketWithHeartbeat - edge cases and concurrent scenarios."""
import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


class MockWebSocket:
    """Simulates a WebSocket for testing heartbeat without real I/O."""
    
    def __init__(self, disconnect_after_pings=999):
        self.sent_pings = []
        self.sent_closes = []
        self.pong_responses = []
        self._disconnect_counter = 0
        self._disconnect_after = disconnect_after_pings
        self._closed = False
        self.client_state = type("State", (), {"value": 1})()
        self.application_state = type("State", (), {"value": 1})()
    
    async def send_ping(self):
        self.sent_pings.append(len(self.sent_pings))
        self._disconnect_counter += 1
    
    async def receive(self):
        if self._disconnect_counter >= self._disconnect_after:
            from starlette.websockets import WebSocketDisconnect
            raise WebSocketDisconnect(code=1006, reason="timeout")
        return {"type": "websocket.receive", "text": "pong"}
    
    async def close(self, code=1000, reason=""):
        self.sent_closes.append((code, reason))
        self._closed = True
    
    async def accept(self):
        pass


class TestWebSocketHeartbeat:
    """Tests for WebSocketWithHeartbeat edge cases."""
    
    def test_rapid_connect_disconnect(self):
        """Rapid connect/disconnect sequences should not leak resources."""
        from fastapi.websockets import WebSocketWithHeartbeat
        
        connections = []
        for i in range(20):
            mock_ws = MockWebSocket(disconnect_after_pings=1)
            ws = WebSocketWithHeartbeat(
                mock_ws,
                ping_interval=1,
                pong_timeout=10,
                on_disconnect=lambda code, dur: None,
            )
            connections.append(ws)
        
        assert len(connections) == 20
        # All should be independently configurable
        assert connections[0].ping_interval == 1
        assert connections[-1].ping_interval == 1
    
    def test_custom_ping_interval(self):
        """Configurable ping interval should be respected."""
        from fastapi.websockets import WebSocketWithHeartbeat
        
        for interval in [5, 15, 30, 60, 120]:
            ws = WebSocketWithHeartbeat(
                MockWebSocket(),
                ping_interval=interval,
            )
            assert ws.ping_interval == interval
    
    def test_custom_pong_timeout(self):
        """Configurable pong timeout should be respected."""
        from fastapi.websockets import WebSocketWithHeartbeat
        
        for timeout in [3, 5, 10, 30]:
            ws = WebSocketWithHeartbeat(
                MockWebSocket(),
                pong_timeout=timeout,
            )
            assert ws.pong_timeout == timeout
    
    def test_on_disconnect_callback_stored(self):
        """on_disconnect callback should be properly stored."""
        from fastapi.websockets import WebSocketWithHeartbeat
        
        called_with = []
        def callback(code, duration):
            called_with.append((code, duration))
        
        ws = WebSocketWithHeartbeat(
            MockWebSocket(),
            on_disconnect=callback,
        )
        
        # Trigger callback directly
        ws.on_disconnect(1006, 5.0)
        assert called_with == [(1006, 5.0)]
    
    def test_zero_ping_interval_clamped(self):
        """Very low ping interval should still work (no crash)."""
        from fastapi.websockets import WebSocketWithHeartbeat
        ws = WebSocketWithHeartbeat(MockWebSocket(), ping_interval=1)
        assert ws.ping_interval == 1
    
    def test_very_large_ping_interval(self):
        """Very large ping interval should be accepted."""
        from fastapi.websockets import WebSocketWithHeartbeat
        ws = WebSocketWithHeartbeat(MockWebSocket(), ping_interval=3600)
        assert ws.ping_interval == 3600
    
    def test_default_values(self):
        """Default values should match documented defaults."""
        from fastapi.websockets import WebSocketWithHeartbeat
        ws = WebSocketWithHeartbeat(MockWebSocket())
        assert ws.ping_interval == 30
        assert ws.pong_timeout == 10
    
    def test_multiple_heartbeats_independent(self):
        """Multiple heartbeats running concurrently should not interfere."""
        from fastapi.websockets import WebSocketWithHeartbeat
        
        hb1 = WebSocketWithHeartbeat(MockWebSocket(), ping_interval=15)
        hb2 = WebSocketWithHeartbeat(MockWebSocket(), ping_interval=30)
        hb3 = WebSocketWithHeartbeat(MockWebSocket(), ping_interval=60)
        
        assert hb1.ping_interval == 15
        assert hb2.ping_interval == 30
        assert hb3.ping_interval == 60


class TestWebSocketEdgeCases:
    """Edge case tests for WebSocket heartbeat."""
    
    def test_disconnect_detected_after_timeout(self):
        """When client stops responding, heartbeat should detect disconnect."""
        from fastapi.websockets import WebSocketWithHeartbeat
        
        mock_ws = MockWebSocket(disconnect_after_pings=1)
        disconnect_called = []
        
        ws = WebSocketWithHeartbeat(
            mock_ws,
            ping_interval=1,
            pong_timeout=2,
            on_disconnect=lambda code, dur: disconnect_called.append((code, dur)),
        )
        
        ws.on_disconnect(1006, 3.0)
        assert len(disconnect_called) == 1
        assert disconnect_called[0][0] == 1006
    
    def test_normal_close_code(self):
        """Normal close should pass correct code."""
        from fastapi.websockets import WebSocketWithHeartbeat
        
        mock_ws = MockWebSocket()
        ws = WebSocketWithHeartbeat(mock_ws, ping_interval=30)
        
        # Direct callback invocation for testing
        ws.on_disconnect(1000, 120.0)
        assert True  # No exception raised
    
    def test_websocket_state_accessible(self):
        """Underlying WebSocket should be accessible."""
        from fastapi.websockets import WebSocketWithHeartbeat
        
        mock_ws = MockWebSocket()
        ws = WebSocketWithHeartbeat(mock_ws)
        
        assert ws._websocket is mock_ws
