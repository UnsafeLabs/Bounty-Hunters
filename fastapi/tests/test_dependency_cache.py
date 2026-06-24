"""Tests for dependency caching with use_cache parameter."""

from __future__ import annotations

from typing import Annotated

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

call_counter: dict[str, int] = {}


def reset_counters() -> None:
    call_counter.clear()


def tracked_dep(name: str):
    """Create a dependency that tracks how many times it's called."""

    def _dep() -> str:
        call_counter[name] = call_counter.get(name, 0) + 1
        return name

    return _dep


# ---------------------------------------------------------------------------
# Tests: use_cache=True (default behavior)
# ---------------------------------------------------------------------------


class TestDependencyCacheDefault:
    def test_cached_dependency_called_once(self):
        """Default use_cache=True should call dependency only once per request."""
        reset_counters()
        app = FastAPI()
        dep = tracked_dep("cached")

        @app.get("/test")
        async def endpoint(
            a: Annotated[str, Depends(dep)],
            b: Annotated[str, Depends(dep)],
        ):
            return {"a": a, "b": b, "count": call_counter.get("cached", 0)}

        client = TestClient(app)
        resp = client.get("/test")
        data = resp.json()
        assert data["a"] == "cached"
        assert data["b"] == "cached"
        assert data["count"] == 1  # Only called once


class TestDependencyCacheExplicit:
    def test_explicit_use_cache_true(self):
        """Explicit use_cache=True should call dependency only once."""
        reset_counters()
        app = FastAPI()
        dep = tracked_dep("explicit_cached")

        @app.get("/test")
        async def endpoint(
            a: Annotated[str, Depends(dep, use_cache=True)],
            b: Annotated[str, Depends(dep, use_cache=True)],
        ):
            return {"a": a, "b": b, "count": call_counter.get("explicit_cached", 0)}

        client = TestClient(app)
        resp = client.get("/test")
        data = resp.json()
        assert data["count"] == 1


# ---------------------------------------------------------------------------
# Tests: use_cache=False
# ---------------------------------------------------------------------------


class TestDependencyNoCache:
    def test_uncached_dependency_called_every_time(self):
        """use_cache=False should call dependency every time it's injected."""
        reset_counters()
        app = FastAPI()
        dep = tracked_dep("uncached")

        @app.get("/test")
        async def endpoint(
            a: Annotated[str, Depends(dep, use_cache=False)],
            b: Annotated[str, Depends(dep, use_cache=False)],
        ):
            return {"a": a, "b": b, "count": call_counter.get("uncached", 0)}

        client = TestClient(app)
        resp = client.get("/test")
        data = resp.json()
        assert data["a"] == "uncached"
        assert data["b"] == "uncached"
        assert data["count"] == 2  # Called twice


# ---------------------------------------------------------------------------
# Tests: Cross-request isolation
# ---------------------------------------------------------------------------


class TestCrossRequestIsolation:
    def test_cache_does_not_leak_between_requests(self):
        """Cache should be scoped to each request independently."""
        reset_counters()
        app = FastAPI()
        dep = tracked_dep("isolated")

        @app.get("/test")
        async def endpoint(
            a: Annotated[str, Depends(dep)],
        ):
            return {"a": a, "count": call_counter.get("isolated", 0)}

        client = TestClient(app)

        # First request
        resp1 = client.get("/test")
        assert resp1.json()["count"] == 1

        # Second request - counter should increment
        resp2 = client.get("/test")
        assert resp2.json()["count"] == 2  # New call, not cached across requests


# ---------------------------------------------------------------------------
# Tests: Async dependencies
# ---------------------------------------------------------------------------


class TestAsyncDependencyCache:
    def test_async_cached_dependency(self):
        """Async dependencies should also be cached."""
        reset_counters()
        app = FastAPI()

        async def async_dep() -> str:
            call_counter["async_cached"] = call_counter.get("async_cached", 0) + 1
            return "async_value"

        @app.get("/test")
        async def endpoint(
            a: Annotated[str, Depends(async_dep)],
            b: Annotated[str, Depends(async_dep)],
        ):
            return {"a": a, "b": b, "count": call_counter.get("async_cached", 0)}

        client = TestClient(app)
        resp = client.get("/test")
        data = resp.json()
        assert data["a"] == "async_value"
        assert data["b"] == "async_value"
        assert data["count"] == 1

    def test_async_uncached_dependency(self):
        """Async dependencies with use_cache=False should be called every time."""
        reset_counters()
        app = FastAPI()

        async def async_dep() -> str:
            call_counter["async_uncached"] = call_counter.get("async_uncached", 0) + 1
            return "async_value"

        @app.get("/test")
        async def endpoint(
            a: Annotated[str, Depends(async_dep, use_cache=False)],
            b: Annotated[str, Depends(async_dep, use_cache=False)],
        ):
            return {"a": a, "b": b, "count": call_counter.get("async_uncached", 0)}

        client = TestClient(app)
        resp = client.get("/test")
        data = resp.json()
        assert data["count"] == 2


# ---------------------------------------------------------------------------
# Tests: Mixed cached and uncached
# ---------------------------------------------------------------------------


class TestMixedCacheBehavior:
    def test_same_dep_cached_and_uncached(self):
        """Same dependency can be used with both cached and uncached."""
        reset_counters()
        app = FastAPI()

        def mixed_dep() -> str:
            call_counter["mixed"] = call_counter.get("mixed", 0) + 1
            return "mixed_value"

        @app.get("/test")
        async def endpoint(
            a: Annotated[str, Depends(mixed_dep, use_cache=True)],
            b: Annotated[str, Depends(mixed_dep, use_cache=False)],
        ):
            return {"a": a, "b": b, "count": call_counter.get("mixed", 0)}

        client = TestClient(app)
        resp = client.get("/test")
        data = resp.json()
        assert data["a"] == "mixed_value"
        assert data["b"] == "mixed_value"
        # First call for 'a' (cached), second call for 'b' (uncached)
        assert data["count"] == 2
