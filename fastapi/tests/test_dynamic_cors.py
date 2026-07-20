"""Tests for DynamicCORSMiddleware (#763)."""

from __future__ import annotations

import asyncio
import importlib.util
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "fastapi" / "middleware" / "dynamic_cors.py"


def _stub_starlette():
    if "starlette.datastructures" in sys.modules:
        return
    # Minimal stubs
    st = types.ModuleType("starlette")
    ds = types.ModuleType("starlette.datastructures")

    class Headers(dict):
        def __init__(self, scope=None, headers=None):
            super().__init__()
            if headers:
                for k, v in headers:
                    self[k.decode() if isinstance(k, bytes) else k.lower()] = (
                        v.decode() if isinstance(v, bytes) else v
                    )
            if scope and "headers" in scope:
                for k, v in scope["headers"]:
                    self[k.decode().lower()] = v.decode()

        def get(self, key, default=None):
            return super().get(key.lower(), default)

        def __contains__(self, key):
            return super().__contains__(str(key).lower())

    class MutableHeaders(dict):
        def __init__(self, scope=None):
            super().__init__()
            self._scope = scope
            if scope and "headers" in scope:
                raw = list(scope["headers"])
            else:
                raw = []
            self._raw = raw
            for k, v in raw:
                self[k.decode().lower()] = v.decode()

        def __setitem__(self, key, value):
            super().__setitem__(key.lower(), value)
            kb, vb = key.lower().encode(), str(value).encode()
            self._raw = [(k, v) for k, v in self._raw if k.decode().lower() != key.lower()]
            self._raw.append((kb, vb))
            if self._scope is not None:
                self._scope["headers"] = self._raw

        def add_vary_header(self, value):
            existing = self.get("vary")
            if existing:
                self["vary"] = f"{existing}, {value}"
            else:
                self["vary"] = value

    ds.Headers = Headers
    ds.MutableHeaders = MutableHeaders

    resp = types.ModuleType("starlette.responses")

    class PlainTextResponse:
        def __init__(self, body, status_code=200, headers=None):
            self.body = body.encode() if isinstance(body, str) else body
            self.status_code = status_code
            self.headers = headers or {}

        async def __call__(self, scope, receive, send):
            raw = [(k.lower().encode(), str(v).encode()) for k, v in self.headers.items()]
            await send(
                {
                    "type": "http.response.start",
                    "status": self.status_code,
                    "headers": raw,
                }
            )
            await send({"type": "http.response.body", "body": self.body})

    class Response(PlainTextResponse):
        pass

    resp.PlainTextResponse = PlainTextResponse
    resp.Response = Response

    types_mod = types.ModuleType("starlette.types")
    types_mod.ASGIApp = object
    types_mod.Message = dict
    types_mod.Receive = object
    types_mod.Scope = dict
    types_mod.Send = object
    sys.modules["starlette"] = st
    sys.modules["starlette.datastructures"] = ds
    sys.modules["starlette.responses"] = resp
    sys.modules["starlette.types"] = types_mod


def _load():
    _stub_starlette()
    name = "dynamic_cors_local"
    if name in sys.modules:
        del sys.modules[name]
    # also stub fastapi.middleware package path not needed for direct file load
    spec = importlib.util.spec_from_file_location(name, PATH)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


async def _run_app(app, scope, messages_out):
    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        messages_out.append(message)

    await app(scope, receive, send)


def test_dynamic_allow_deny():
    mod = _load()

    async def main():
        allowed = []

        async def inner(scope, receive, send):
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"ok"})

        mw = mod.DynamicCORSMiddleware(
            inner,
            allow_origin_func=lambda o: o == "https://good.example",
            cors_max_age=120,
            allow_methods=["GET", "POST"],
        )
        # preflight allow
        out = []
        scope = {
            "type": "http",
            "method": "OPTIONS",
            "headers": [
                (b"origin", b"https://good.example"),
                (b"access-control-request-method", b"POST"),
            ],
        }
        await _run_app(mw, scope, out)
        start = next(m for m in out if m["type"] == "http.response.start")
        assert start["status"] == 200
        headers = {k.decode(): v.decode() for k, v in start["headers"]}
        assert headers["access-control-allow-origin"] == "https://good.example"
        assert headers["access-control-max-age"] == "120"

        # preflight deny
        out2 = []
        scope2 = {
            "type": "http",
            "method": "OPTIONS",
            "headers": [
                (b"origin", b"https://bad.example"),
                (b"access-control-request-method", b"POST"),
            ],
        }
        await _run_app(mw, scope2, out2)
        start2 = next(m for m in out2 if m["type"] == "http.response.start")
        assert start2["status"] == 400

    asyncio.run(main())


def test_async_callback():
    mod = _load()

    async def main():
        async def allow(o: str) -> bool:
            await asyncio.sleep(0)
            return o.endswith(".async.test")

        async def inner(scope, receive, send):
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"ok"})

        mw = mod.DynamicCORSMiddleware(inner, allow_origin_func=allow, cors_max_age=60)
        out = []
        scope = {
            "type": "http",
            "method": "OPTIONS",
            "headers": [
                (b"origin", b"https://x.async.test"),
                (b"access-control-request-method", b"GET"),
            ],
        }
        await _run_app(mw, scope, out)
        start = next(m for m in out if m["type"] == "http.response.start")
        assert start["status"] == 200

    asyncio.run(main())


def test_fallback_static_list():
    mod = _load()

    async def main():
        async def inner(scope, receive, send):
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"ok"})

        mw = mod.DynamicCORSMiddleware(
            inner,
            allow_origins=["https://static.example"],
            cors_max_age=300,
            allow_methods=["GET"],
        )
        out = []
        scope = {
            "type": "http",
            "method": "OPTIONS",
            "headers": [
                (b"origin", b"https://static.example"),
                (b"access-control-request-method", b"GET"),
            ],
        }
        await _run_app(mw, scope, out)
        start = next(m for m in out if m["type"] == "http.response.start")
        assert start["status"] == 200
        headers = {k.decode(): v.decode() for k, v in start["headers"]}
        assert headers["access-control-max-age"] == "300"

    asyncio.run(main())


if __name__ == "__main__":
    test_dynamic_allow_deny()
    print("ok allow/deny")
    test_async_callback()
    print("ok async")
    test_fallback_static_list()
    print("ok static fallback")
    print("ALL PASSED")
