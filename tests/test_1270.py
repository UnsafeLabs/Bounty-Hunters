"""Tests for SSEManager broadcast and disconnect detection"""
import pytest
import asyncio

class TestSSEManager:
    def test_connect_and_disconnect(self):
        from fastapi.sse import SSEManager
        mgr = SSEManager()
        client_id = mgr.connect()
        assert client_id is not None
        assert mgr.connection_count() >= 1
        mgr.disconnect(client_id)
        assert mgr.connection_count() == 0

    def test_connection_count_empty(self):
        from fastapi.sse import SSEManager
        mgr = SSEManager()
        assert mgr.connection_count() == 0

    def test_broadcast_to_connected_clients(self):
        from fastapi.sse import SSEManager
        mgr = SSEManager()
        c1 = mgr.connect()
        c2 = mgr.connect()
        assert mgr.connection_count() == 2
        sent = mgr.broadcast("hello world")
        assert sent >= 2

    def test_filter_by_event_type(self):
        from fastapi.sse import SSEManager
        mgr = SSEManager()
        c1 = mgr.connect(event_types=["update"])
        c2 = mgr.connect(event_types=["alert"])
        filtered = mgr.get_connections(event_type="update")
        assert len(filtered) >= 1

    def test_disconnect_nonexistent(self):
        from fastapi.sse import SSEManager
        mgr = SSEManager()
        mgr.disconnect("nonexistent")
        assert mgr.connection_count() == 0
