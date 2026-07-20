"""Tests for request-scoped dependency caching (#795)."""
from __future__ import annotations
import asyncio
import importlib.util
import sys
from pathlib import Path

PATH = Path(__file__).resolve().parents[1] / "fastapi" / "dependency_cache.py"

def _load():
    name = "dep_cache_local"
    if name in sys.modules:
        del sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, PATH)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod

def test_cache_hit_same_request():
    mod = _load()
    calls = {"n": 0}
    def dep():
        calls["n"] += 1
        return {"id": calls["n"]}
    cache = mod.RequestDependencyCache()
    a = mod.resolve_dependency(dep, use_cache=True, cache=cache)
    b = mod.resolve_dependency(dep, use_cache=True, cache=cache)
    assert a is b
    assert calls["n"] == 1

def test_cache_miss_when_disabled():
    mod = _load()
    calls = {"n": 0}
    def dep():
        calls["n"] += 1
        return calls["n"]
    cache = mod.RequestDependencyCache()
    a = mod.resolve_dependency(dep, use_cache=False, cache=cache)
    b = mod.resolve_dependency(dep, use_cache=False, cache=cache)
    assert a == 1 and b == 2
    assert calls["n"] == 2

def test_cross_request_isolation():
    mod = _load()
    calls = {"n": 0}
    def dep():
        calls["n"] += 1
        return calls["n"]
    c1 = mod.RequestDependencyCache()
    c2 = mod.RequestDependencyCache()
    assert mod.resolve_dependency(dep, cache=c1) == 1
    assert mod.resolve_dependency(dep, cache=c2) == 2
    assert calls["n"] == 2

def test_async_dep():
    mod = _load()
    calls = {"n": 0}
    async def dep():
        calls["n"] += 1
        return "ok"
    cache = mod.RequestDependencyCache()
    async def main():
        a = await mod.resolve_dependency_async(dep, cache=cache)
        b = await mod.resolve_dependency_async(dep, cache=cache)
        assert a == b == "ok"
        assert calls["n"] == 1
    asyncio.run(main())

if __name__ == "__main__":
    test_cache_hit_same_request(); print("ok hit")
    test_cache_miss_when_disabled(); print("ok miss")
    test_cross_request_isolation(); print("ok iso")
    test_async_dep(); print("ok async")
    print("ALL PASSED")
