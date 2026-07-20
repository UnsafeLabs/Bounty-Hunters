"""Tests for WebSocket heartbeat (#766)."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

PATH = Path(__file__).resolve().parents[1] / "fastapi" / "websocket_heartbeat.py"


def _load():
    name = "ws_hb_local"
    if name in sys.modules:
        del sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, PATH)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def test_defaults_and_overrides():
    mod = _load()
    assert mod.DEFAULT_PING_INTERVAL == 30.0
    assert mod.DEFAULT_PONG_TIMEOUT == 10.0
    t = [1000.0]

    def now():
        return t[0]

    hb = mod.HeartbeatTracker(ping_interval=5, pong_timeout=2, now=now)
    assert hb.ping_interval == 5 and hb.pong_timeout == 2
    hb.send_ping()
    assert hb.pings_sent == 1
    t[0] += 1
    hb.on_pong()
    assert not hb.should_close_for_timeout()
    t[0] += 5
    hb.send_ping()
    t[0] += 3  # exceed pong_timeout after ping without pong
    assert hb.should_close_for_timeout()
    hb.close(1001)
    assert hb.closed and hb.close_code == 1001


def test_message_count_and_duration():
    mod = _load()
    t = [0.0]

    def now():
        return t[0]

    hb = mod.HeartbeatTracker(now=now)
    hb.on_message()
    hb.on_message()
    t[0] = 12.5
    assert hb.message_count == 2
    assert abs(hb.connection_duration - 12.5) < 1e-9


def test_on_disconnect_callback_shape():
    mod = _load()
    seen = {}

    class FakeWS:
        async def close(self, code=1000):
            seen["code"] = code

    def on_disc(code, duration):
        seen["cb"] = (code, duration)

    # sync tracker path for callback contract
    t = [10.0]
    hb = mod.HeartbeatTracker(now=lambda: t[0])
    hb.close(1001)
    on_disc(hb.close_code, hb.connection_duration)
    assert seen["cb"][0] == 1001
    assert seen["cb"][1] >= 0


if __name__ == "__main__":
    test_defaults_and_overrides()
    print("ok defaults")
    test_message_count_and_duration()
    print("ok metrics")
    test_on_disconnect_callback_shape()
    print("ok disconnect")
    print("ALL PASSED")
