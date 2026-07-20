"""Tests for SSEManager (issue #798)."""

from __future__ import annotations

import asyncio
import importlib.util
import sys
from pathlib import Path

_PATH = Path(__file__).resolve().parents[1] / "fastapi" / "sse_manager.py"


def _load():
    name = "sse_manager_local"
    if name in sys.modules:
        del sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, _PATH)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def test_filter_and_broadcast():
    mod = _load()

    async def main():
        mgr = mod.SSEManager(default_retry_ms=1500)
        c_all = await mgr.connect()
        c_chat = await mgr.connect(event_type="chat")
        await mgr.publish("hello", event="chat")
        await mgr.publish("sys", event="system")
        # all gets both; chat only chat
        e1 = await asyncio.wait_for(c_all.queue.get(), timeout=1)
        e2 = await asyncio.wait_for(c_all.queue.get(), timeout=1)
        assert {e1.event, e2.event} == {"chat", "system"}
        e3 = await asyncio.wait_for(c_chat.queue.get(), timeout=1)
        assert e3.event == "chat" and e3.data == "hello"
        assert c_chat.queue.empty()
        await mgr.disconnect(c_all.conn_id)
        await mgr.disconnect(c_chat.conn_id)

    asyncio.run(main())


def test_replay_last_event_id():
    mod = _load()

    async def main():
        mgr = mod.SSEManager()
        e1 = await mgr.publish("a", event="m")
        e2 = await mgr.publish("b", event="m")
        e3 = await mgr.publish("c", event="m")
        conn = await mgr.connect(last_event_id=e1.id)
        chunks = []
        # only take replay portion via private helper
        replay = mgr._events_after(e1.id)
        assert [x.data for x in replay] == ["b", "c"]
        assert e2.id and e3.id
        await mgr.disconnect(conn.conn_id)

    asyncio.run(main())


def test_retry_field_in_stream():
    mod = _load()

    async def main():
        mgr = mod.SSEManager(default_retry_ms=2500)
        conn = await mgr.connect(retry_ms=2500)
        await mgr.publish("x", event="m", retry=2500)
        gen = mgr.stream(conn)
        first = await gen.__anext__()
        assert first.startswith("retry: 2500")
        second = await gen.__anext__()
        assert "retry: 2500" in second
        assert "data: x" in second
        await mgr.disconnect(conn.conn_id)

    asyncio.run(main())


def test_disconnect_stops_cleanly():
    mod = _load()

    async def main():
        mgr = mod.SSEManager()
        disconnected = {"v": False}

        async def produce():
            for i in range(5):
                await mgr.publish(f"n{i}", event="tick")
                await asyncio.sleep(0.01)

        prod = asyncio.create_task(produce())
        chunks = []
        async for ch in mod.sse_event_generator(
            mgr, is_disconnected=lambda: disconnected["v"]
        ):
            chunks.append(ch)
            if len(chunks) >= 3:
                disconnected["v"] = True
        await prod
        assert len(chunks) >= 1
        # no exception raised

    asyncio.run(main())


def test_encode_format():
    mod = _load()
    ev = mod.SSEEvent(id="9", event="chat", data="hi", retry=1000)
    wire = ev.encode()
    assert "id: 9" in wire
    assert "event: chat" in wire
    assert "retry: 1000" in wire
    assert "data: hi" in wire
    assert wire.endswith("\n\n")


if __name__ == "__main__":
    for n, f in list(globals().items()):
        if n.startswith("test_") and callable(f):
            f()
            print("ok", n)
    print("ALL PASSED")
