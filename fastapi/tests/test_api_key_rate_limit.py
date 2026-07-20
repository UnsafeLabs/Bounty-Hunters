"""Tests for APIKeyWithRateLimit (issue #768) — importlib, no full FastAPI install."""

from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path

_PATH = Path(__file__).resolve().parents[1] / "fastapi" / "security" / "api_key_rate_limit.py"


def _load():
    # stub starlette + fastapi.security.api_key
    if "starlette.exceptions" not in sys.modules:
        st = types.ModuleType("starlette")
        exc = types.ModuleType("starlette.exceptions")
        class HTTPException(Exception):
            def __init__(self, status_code, detail=None, headers=None):
                self.status_code = status_code
                self.detail = detail
                self.headers = headers or {}
        exc.HTTPException = HTTPException
        req = types.ModuleType("starlette.requests")
        class Request: pass
        req.Request = Request
        resp = types.ModuleType("starlette.responses")
        class Response:
            def __init__(self):
                self.headers = {}
        resp.Response = Response
        status = types.ModuleType("starlette.status")
        status.HTTP_401_UNAUTHORIZED = 401
        status.HTTP_429_TOO_MANY_REQUESTS = 429
        sys.modules["starlette"] = st
        sys.modules["starlette.exceptions"] = exc
        sys.modules["starlette.requests"] = req
        sys.modules["starlette.responses"] = resp
        sys.modules["starlette.status"] = status

    if "fastapi" not in sys.modules:
        sys.modules["fastapi"] = types.ModuleType("fastapi")
    if "fastapi.security" not in sys.modules:
        sys.modules["fastapi.security"] = types.ModuleType("fastapi.security")
    if "fastapi.security.api_key" not in sys.modules:
        ak = types.ModuleType("fastapi.security.api_key")
        class APIKeyHeader:
            def __init__(self, **kwargs):
                self.model = type("M", (), {"name": kwargs.get("name", "X-API-Key")})()
                self.auto_error = kwargs.get("auto_error", True)
        ak.APIKeyHeader = APIKeyHeader
        sys.modules["fastapi.security.api_key"] = ak

    name = "api_key_rate_limit_local"
    if name in sys.modules:
        del sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, _PATH)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def test_parse_rate_limit():
    mod = _load()
    assert mod.parse_rate_limit("100/minute") == (100, 60)
    assert mod.parse_rate_limit("1000/hour") == (1000, 3600)
    assert mod.parse_rate_limit("10/second") == (10, 1)
    try:
        mod.parse_rate_limit("nope")
        assert False
    except ValueError:
        pass


def test_sliding_window_enforcement():
    mod = _load()
    c = mod.SlidingWindowCounter()
    now = 1_000_000.0
    for i in range(3):
        count, _ = c.hit("k", now=now + i * 0.01, window_seconds=60)
    assert count == 3
    # after window expires
    count2, _ = c.hit("k", now=now + 61, window_seconds=60)
    assert count2 == 1


def test_rate_limit_429_retry_after():
    mod = _load()
    auth = mod.APIKeyWithRateLimit(rate_limit="3/minute", valid_keys=["good"])
    now = 2_000_000.0
    assert auth.check_rate_limit("good", now=now) is None
    assert auth.check_rate_limit("good", now=now + 0.1) is None
    assert auth.check_rate_limit("good", now=now + 0.2) is None
    retry = auth.check_rate_limit("good", now=now + 0.3)
    assert retry is not None and retry >= 1


def test_per_key_independence():
    mod = _load()
    auth = mod.APIKeyWithRateLimit(rate_limit="2/minute")
    now = 3_000_000.0
    assert auth.check_rate_limit("a", now=now) is None
    assert auth.check_rate_limit("a", now=now + 0.1) is None
    assert auth.check_rate_limit("a", now=now + 0.2) is not None
    # other key still ok
    assert auth.check_rate_limit("b", now=now + 0.2) is None


def test_deprecated_warning():
    mod = _load()
    auth = mod.APIKeyWithRateLimit(
        rate_limit="100/minute",
        deprecated_keys=["old-key"],
        valid_keys=["new-key", "old-key"],
    )
    assert auth.is_deprecated("old-key") is True
    assert auth.is_deprecated("new-key") is False
    resp = mod.Response() if hasattr(mod, "Response") else type("R", (), {"headers": {}})()
    # use starlette Response from module's dependency - re-get
    from starlette.responses import Response
    r = Response()
    auth.apply_warning_header(r, "old-key")
    assert "Warning" in r.headers
    r2 = Response()
    auth.apply_warning_header(r2, "new-key")
    assert "Warning" not in r2.headers


if __name__ == "__main__":
    for n, f in list(globals().items()):
        if n.startswith("test_") and callable(f):
            f()
            print("ok", n)
    print("ALL PASSED")
