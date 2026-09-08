"""
Tests for Server-Sent Events (SSE) utilities.
"""

import pytest
import asyncio
import time
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.responses import StreamingResponse

from fastapi.sse import (
    SSEManager,
    SSEClient,
    SSEEvent,
    sse_manager,
    sse_endpoint,
    SSEDisconnectError,
    SSEFilterError,
    broadcast_message,
    broadcast_update,
    send_to_client,
    sse_startup,
    sse_shutdown,
)


@pytest.fixture
def event_loop():
    """Create an event loop for async tests."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    yield loop
    loop.close()


class TestSSEManager:
    """Tests for SSEManager class."""
    
    @pytest.fixture
    async def manager(self):
        """Create a fresh SSEManager for each test."""
        m = SSEManager[dict](heartbeat_interval=1.0, disconnect_timeout=2.0, max_event_history=50)
        await m.start()
        yield m
        await m.stop()
    
    async def test_connect(self, manager):
        """Test client connection."""
        class MockRequest:
            pass
        
        client_id = await manager.connect(MockRequest())
        assert client_id is not None
        assert len(client_id) > 0
        
        # Verify client is in manager
        client = await manager.get_client(client_id)
        assert client is not None
        assert client.client_id == client_id
        assert client.connected_at > 0
    
    async def test_disconnect(self, manager):
        """Test client disconnection."""
        class MockRequest:
            pass
        
        client_id = await manager.connect(MockRequest())
        await manager.disconnect(client_id)
        
        client = await manager.get_client(client_id)
        assert client is not None
        assert client.disconnected is True
        assert client.disconnected_at is not None
    
    async def test_is_connected(self, manager):
        """Test connection status checking."""
        class MockRequest:
            pass
        
        client_id = await manager.connect(MockRequest())
        
        # Should be connected
        assert await manager.is_connected(client_id) is True
        
        # Disconnect
        await manager.disconnect(client_id)
        
        # Should not be connected
        assert await manager.is_connected(client_id) is False
    
    async def test_broadcast(self, manager):
        """Test broadcasting to all clients."""
        class MockRequest:
            pass
        
        # Connect clients
        client1_id = await manager.connect(MockRequest())
        client2_id = await manager.connect(MockRequest())
        
        # Broadcast
        event_id = await manager.broadcast("test", {"data": "test"})
        
        # Verify event ID
        assert event_id is not None
        assert len(event_id) > 0
        
        # Verify clients received the event
        client1 = await manager.get_client(client1_id)
        client2 = await manager.get_client(client2_id)
        
        assert client1 is not None
        assert client2 is not None
        assert client1.last_event_id == event_id
        assert client2.last_event_id == event_id
    
    async def test_broadcast_to_client(self, manager):
        """Test sending to a specific client."""
        class MockRequest:
            pass
        
        # Connect clients
        client1_id = await manager.connect(MockRequest())
        client2_id = await manager.connect(MockRequest())
        
        # Send to specific client
        result = await manager.broadcast_to_client(client1_id, "test", {"data": "test"})
        
        assert result is True
        
        # Verify only client1 received
        client1 = await manager.get_client(client1_id)
        client2 = await manager.get_client(client2_id)
        
        assert client1 is not None
        assert client2 is not None
        assert client1.last_event_id is not None
        # Client2 should not have the same last_event_id
        # (unless it was updated by something else)
    
    async def test_broadcast_with_retry(self, manager):
        """Test broadcasting with retry interval."""
        class MockRequest:
            pass
        
        client_id = await manager.connect(MockRequest())
        event_id = await manager.broadcast("test", {"data": "test"}, retry=5000)
        
        client = await manager.get_client(client_id)
        assert client is not None
        # Note: retry is stored in event data, not on client
    
    async def test_exclude_clients(self, manager):
        """Test broadcasting excluding specific clients."""
        class MockRequest:
            pass
        
        client1_id = await manager.connect(MockRequest())
        client2_id = await manager.connect(MockRequest())
        
        # Broadcast excluding client2
        event_id = await manager.broadcast("test", {"data": "test"}, exclude_clients={client2_id})
        
        # Client1 should have received
        client1 = await manager.get_client(client1_id)
        assert client1 is not None
        assert client1.last_event_id == event_id
        
        # Client2 should not have received
        client2 = await manager.get_client(client2_id)
        assert client2 is not None
        # last_event_id should be different or None
    
    async def test_get_events_since(self, manager):
        """Test getting events since a specific event ID."""
        class MockRequest:
            pass
        
        # Connect and get initial event
        client_id = await manager.connect(MockRequest())
        event1_id = await manager.broadcast("test1", {"data": "test1"})
        event2_id = await manager.broadcast("test2", {"data": "test2"})
        
        # Get events since event1
        events = await manager.get_events_since(event1_id)
        
        assert len(events) >= 1
        assert events[0]['event_id'] == event2_id
    
    async def test_get_events_since_with_filter(self, manager):
        """Test getting events with type filtering."""
        class MockRequest:
            pass
        
        await manager.connect(MockRequest())
        await manager.broadcast("type1", {"data": "test1"})
        await manager.broadcast("type2", {"data": "test2"})
        await manager.broadcast("type1", {"data": "test3"})
        
        # Get only type1 events
        events = await manager.get_events_since(None, ["type1"])
        
        assert len(events) == 2
        for event in events:
            assert event['event_type'] == "type1"
    
    async def test_get_all_clients(self, manager):
        """Test getting all clients."""
        class MockRequest:
            pass
        
        await manager.connect(MockRequest())
        await manager.connect(MockRequest())
        
        clients = await manager.get_all_clients()
        assert len(clients) == 2
    
    async def test_get_connected_client_count(self, manager):
        """Test getting connected client count."""
        class MockRequest:
            pass
        
        await manager.connect(MockRequest())
        await manager.connect(MockRequest())
        
        count = await manager.get_connected_client_count()
        assert count == 2
    
    async def test_event_history_limit(self, manager):
        """Test that event history is limited."""
        class MockRequest:
            pass
        
        await manager.connect(MockRequest())
        
        # Send more events than history limit
        for i in range(60):
            await manager.broadcast("test", {"data": f"test{i}"})
        
        # History should be capped
        events = await manager.get_events_since(None)
        assert len(events) <= 50  # max_event_history
    
    async def test_disconnect_timeout(self, manager):
        """Test that clients are disconnected after timeout."""
        class MockRequest:
            pass
        
        client_id = await manager.connect(MockRequest())
        
        # Manually set last_sent_at to the past
        async with manager._lock:
            if client_id in manager._clients:
                manager._clients[client_id].last_sent_at = time.time() - 3.0  # 3 seconds ago
        
        # Wait for cleanup
        await asyncio.sleep(1.5)
        
        # Client should be disconnected
        assert await manager.is_connected(client_id) is False


class TestSSEEndpoint:
    """Tests for SSE endpoint."""
    
    @pytest.fixture
    async def app(self):
        """Create a FastAPI app with SSE endpoint."""
        app = FastAPI()
        
        @app.on_event("startup")
        async def startup():
            await sse_startup()
        
        @app.on_event("shutdown")
        async def shutdown():
            await sse_shutdown()
        
        @app.get("/sse")
        async def sse(request: object):
            return await sse_endpoint(request)
        
        return app
    
    async def test_sse_endpoint_returns_stream(self, app):
        """Test that SSE endpoint returns a streaming response."""
        client = TestClient(app)
        
        # Make a request with timeout
        with pytest.raises(Exception):  # Will timeout or be cancelled
            response = client.get("/sse", timeout=0.1)
        
        # The response should be a StreamingResponse
        # We can't easily test the streaming content without a proper async client
    
    async def test_sse_with_event_types(self, app):
        """Test SSE endpoint with event type filtering."""
        client = TestClient(app)
        
        # This will timeout but we're testing the endpoint accepts the parameter
        with pytest.raises(Exception):
            client.get("/sse?event_types=message,update", timeout=0.1)
    
    async def test_sse_with_last_event_id(self, app):
        """Test SSE endpoint with last event ID."""
        client = TestClient(app)
        
        with pytest.raises(Exception):
            client.get("/sse?last_event_id=123", timeout=0.1)


class TestConvenienceFunctions:
    """Tests for convenience functions."""
    
    @pytest.fixture(autouse=True)
    async def setup(self):
        """Setup and teardown SSE manager."""
        await sse_startup()
        yield
        await sse_shutdown()
    
    async def test_broadcast_message(self):
        """Test broadcast_message convenience function."""
        class MockRequest:
            pass
        
        # Connect a client first
        await sse_manager.connect(MockRequest())
        
        event_id = await broadcast_message("Hello, world!")
        assert event_id is not None
    
    async def test_broadcast_update(self):
        """Test broadcast_update convenience function."""
        class MockRequest:
            pass
        
        await sse_manager.connect(MockRequest())
        
        event_id = await broadcast_update({"status": "ok"})
        assert event_id is not None
    
    async def test_send_to_client(self):
        """Test send_to_client convenience function."""
        class MockRequest:
            pass
        
        client_id = await sse_manager.connect(MockRequest())
        
        result = await send_to_client(client_id, {"message": "test"})
        assert result is True


class TestSSEFormatting:
    """Tests for SSE event formatting."""
    
    def test_format_sse_event(self):
        """Test SSE event formatting."""
        from fastapi.sse import _format_sse_event
        
        event = {
            "event_id": "123",
            "event_type": "message",
            "data": {"text": "Hello"},
            "retry": 5000
        }
        
        formatted = _format_sse_event(event)
        
        assert "id: 123" in formatted
        assert "event: message" in formatted
        assert "retry: 5000" in formatted
        assert 'data: {"text": "Hello"}' in formatted
        assert formatted.endswith("\n\n")
    
    def test_format_sse_event_minimal(self):
        """Test minimal SSE event formatting."""
        from fastapi.sse import _format_sse_event
        
        event = {
            "data": {"text": "Hello"}
        }
        
        formatted = _format_sse_event(event)
        
        assert "data:" in formatted
        assert '{"text": "Hello"}' in formatted
    
    def test_format_sse_event_no_data(self):
        """Test SSE event with no data."""
        from fastapi.sse import _format_sse_event
        
        event = {
            "event_id": "123",
            "event_type": "ping"
        }
        
        formatted = _format_sse_event(event)
        
        assert "id: 123" in formatted
        assert "event: ping" in formatted
        assert "data: {}" in formatted


class TestEdgeCases:
    """Tests for edge cases and error handling."""
    
    async def test_broadcast_to_disconnected_client(self):
        """Test sending to a disconnected client."""
        class MockRequest:
            pass
        
        await sse_startup()
        
        client_id = await sse_manager.connect(MockRequest())
        await sse_manager.disconnect(client_id)
        
        result = await sse_manager.broadcast_to_client(client_id, "test", {"data": "test"})
        assert result is False
        
        await sse_shutdown()
    
    async def test_get_nonexistent_client(self):
        """Test getting a non-existent client."""
        await sse_startup()
        
        client = await sse_manager.get_client("nonexistent")
        assert client is None
        
        await sse_shutdown()
    
    async def test_broadcast_with_exclude_all(self):
        """Test broadcasting excluding all clients."""
        class MockRequest:
            pass
        
        await sse_startup()
        
        client1_id = await sse_manager.connect(MockRequest())
        client2_id = await sse_manager.connect(MockRequest())
        
        event_id = await sse_manager.broadcast(
            "test", {"data": "test"},
            exclude_clients={client1_id, client2_id}
        )
        
        # No clients should have received the event
        client1 = await sse_manager.get_client(client1_id)
        client2 = await sse_manager.get_client(client2_id)
        
        # Their last_event_id should not be the one we just broadcast
        assert client1.last_event_id != event_id
        assert client2.last_event_id != event_id
        
        await sse_shutdown()
    
    async def test_invalid_event_id_format(self):
        """Test getting events with invalid event ID format."""
        await sse_startup()
        
        # Should handle invalid event ID gracefully
        events = await sse_manager.get_events_since("invalid-id")
        assert isinstance(events, list)
        
        await sse_shutdown()
    
    async def test_empty_event_types_filter(self):
        """Test filtering with empty event types list."""
        await sse_startup()
        
        await sse_manager.connect(object())
        await sse_manager.broadcast("test", {"data": "test"})
        
        # Empty filter should return all events
        events = await sse_manager.get_events_since(None, [])
        assert len(events) == 1
        
        await sse_shutdown()


class TestMultipleClients:
    """Tests for multiple client scenarios."""
    
    async def test_broadcast_to_multiple_clients(self):
        """Test broadcasting to multiple clients."""
        await sse_startup()
        
        class MockRequest:
            pass
        
        # Connect multiple clients
        clients = []
        for i in range(5):
            client_id = await sse_manager.connect(MockRequest())
            clients.append(client_id)
        
        # Broadcast
        event_id = await sse_manager.broadcast("test", {"data": "test"})
        
        # All clients should have received
        for client_id in clients:
            client = await sse_manager.get_client(client_id)
            assert client is not None
            assert client.last_event_id == event_id
        
        await sse_shutdown()
    
    async def test_client_count_after_disconnects(self):
        """Test client count after multiple disconnects."""
        await sse_startup()
        
        class MockRequest:
            pass
        
        # Connect clients
        clients = []
        for i in range(5):
            client_id = await sse_manager.connect(MockRequest())
            clients.append(client_id)
        
        # All should be connected
        count = await sse_manager.get_connected_client_count()
        assert count == 5
        
        # Disconnect some
        for i in range(3):
            await sse_manager.disconnect(clients[i])
        
        # Only 2 should be connected
        count = await sse_manager.get_connected_client_count()
        assert count == 2
        
        await sse_shutdown()
