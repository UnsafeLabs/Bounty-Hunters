import pytest
from fastapi import FastAPI
from fastapi.sse import SSEManager, event_stream_with_disconnect, EventSourceResponse
from fastapi.testclient import TestClient
from starlette.requests import Request

app = FastAPI()
manager = SSEManager()

@app.get("/events")
async def sse_events(request: Request):
    conn_id = "test-1"
    await manager.add_connection(conn_id, filters=["update"])
    return EventSourceResponse(manager.event_generator(conn_id))

class TestSSEManager:
    @pytest.mark.asyncio
    async def test_add_and_remove_connection(self):
        m = SSEManager()
        await m.add_connection("conn1", filters=["update"])
        assert "conn1" in m._connections
        await m.remove_connection("conn1")
        assert "conn1" not in m._connections

    @pytest.mark.asyncio
    async def test_broadcast(self):
        m = SSEManager()
        await m.add_connection("conn1")
        await m.broadcast({"msg": "hello"})
        conns = m._connections.get("conn1", [])
        assert len(conns) > 0
        msg = await conns[0]["queue"].get()
        assert msg["data"] == {"msg": "hello"}

    @pytest.mark.asyncio
    async def test_event_filter(self):
        m = SSEManager()
        await m.add_connection("conn2", filters=["update"])
        await m.broadcast({"msg": "update1"}, event_type="update")
        await m.broadcast({"msg": "other"}, event_type="other")
        conns = m._connections.get("conn2", [])
        msg = await conns[0]["queue"].get()
        assert msg["event"] == "update"

    def test_event_source_response(self):
        client = TestClient(app)
        resp = client.get("/events")
        assert resp.status_code == 200
        assert resp.headers.get("content-type") == "text/event-stream"
