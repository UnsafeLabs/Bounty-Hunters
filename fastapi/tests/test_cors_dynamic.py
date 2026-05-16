import asyncio
import time

import pytest
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware, DynamicCORSMiddleware
from fastapi.testclient import TestClient


# ============================================================================
# Fixtures
# ============================================================================

def _make_app() -> FastAPI:
    app = FastAPI()

    @app.get("/")
    async def root():
        return {"ok": True}

    return app


def _make_app_post() -> FastAPI:
    app = FastAPI()

    @app.post("/data")
    async def data():
        return {"received": True}

    return app


# ============================================================================
# Test 1 - Sync callback: dynamic allow
# ============================================================================

TRUSTED = {"https://trusted.example.com", "https://app.example.com"}


def sync_allow(origin: str) -> bool:
    return origin in TRUSTED


def test_sync_dynamic_allow():
    """Dynamic callback (sync) correctly allows a trusted origin."""
    app = _make_app()
    app.add_middleware(
        DynamicCORSMiddleware,
        allow_origin_func=sync_allow,
        allow_methods=["GET"],
    )
    client = TestClient(app)
    resp = client.get("/", headers={"Origin": "https://trusted.example.com"})
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "https://trusted.example.com"


def test_sync_dynamic_deny():
    """Dynamic callback (sync) correctly denies an untrusted origin."""
    app = _make_app()
    app.add_middleware(
        DynamicCORSMiddleware,
        allow_origin_func=sync_allow,
        allow_methods=["GET"],
    )
    client = TestClient(app)
    resp = client.get("/", headers={"Origin": "https://evil.com"})
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") is None


# ============================================================================
# Test 2 - Async callback
# ============================================================================

async def async_allow(origin: str) -> bool:
    await asyncio.sleep(0.01)
    return origin == "https://async-trusted.com"


def test_async_dynamic_allow():
    """Async callback correctly awaits and allows."""
    app = _make_app()
    app.add_middleware(
        DynamicCORSMiddleware,
        allow_origin_func=async_allow,
        allow_methods=["GET"],
    )
    client = TestClient(app)
    resp = client.get("/", headers={"Origin": "https://async-trusted.com"})
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "https://async-trusted.com"


def test_async_dynamic_deny():
    """Async callback correctly awaits and denies."""
    app = _make_app()
    app.add_middleware(
        DynamicCORSMiddleware,
        allow_origin_func=async_allow,
        allow_methods=["GET"],
    )
    client = TestClient(app)
    resp = client.get("/", headers={"Origin": "https://evil.com"})
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") is None


# ============================================================================
# Test 3 - Fallback to static allow_origins when no callback provided
# ============================================================================

def test_fallback_to_static_list():
    """When allow_origin_func is None, static allow_origins is used."""
    app = _make_app()
    app.add_middleware(
        DynamicCORSMiddleware,
        allow_origins=["https://static-allowed.com"],
        allow_methods=["GET"],
    )
    client = TestClient(app)
    resp = client.get("/", headers={"Origin": "https://static-allowed.com"})
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "https://static-allowed.com"


def test_fallback_rejects_unlisted():
    """Without callback, unlisted origins are rejected."""
    app = _make_app()
    app.add_middleware(
        DynamicCORSMiddleware,
        allow_origins=["https://static-allowed.com"],
        allow_methods=["GET"],
    )
    client = TestClient(app)
    resp = client.get("/", headers={"Origin": "https://not-allowed.com"})
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") is None


# ============================================================================
# Test 4 - Preflight (OPTIONS) requests
# ============================================================================

def test_preflight_dynamic_allow():
    """OPTIONS preflight with dynamic allow succeeds."""
    app = _make_app_post()
    app.add_middleware(
        DynamicCORSMiddleware,
        allow_origin_func=sync_allow,
        allow_methods=["POST"],
        allow_headers=["Content-Type"],
    )
    client = TestClient(app)
    resp = client.options(
        "/data",
        headers={
            "Origin": "https://trusted.example.com",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "https://trusted.example.com"


def test_preflight_dynamic_deny():
    """OPTIONS preflight with dynamic deny returns 400."""
    app = _make_app_post()
    app.add_middleware(
        DynamicCORSMiddleware,
        allow_origin_func=sync_allow,
        allow_methods=["POST"],
    )
    client = TestClient(app)
    resp = client.options(
        "/data",
        headers={
            "Origin": "https://evil.com",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert resp.status_code == 400
    assert "origin" in (resp.text or "").lower()


# ============================================================================
# Test 5 - cors_max_age parameter
# ============================================================================

def test_cors_max_age_in_preflight():
    """cors_max_age is reflected in preflight Access-Control-Max-Age header."""
    app = _make_app_post()
    app.add_middleware(
        DynamicCORSMiddleware,
        allow_origin_func=sync_allow,
        allow_methods=["POST"],
        cors_max_age="3600",
    )
    client = TestClient(app)
    resp = client.options(
        "/data",
        headers={
            "Origin": "https://trusted.example.com",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert resp.status_code == 200
    assert resp.headers.get("access-control-max-age") == "3600"


# ============================================================================
# Test 6 - Existing CORSMiddleware import unaffected
# ============================================================================

def test_existing_cors_middleware_export():
    """Original CORSMiddleware is still importable and works."""
    from fastapi.middleware.cors import CORSMiddleware as OrigCORS

    app = _make_app()
    app.add_middleware(
        OrigCORS,
        allow_origins=["https://legacy.com"],
        allow_methods=["GET"],
    )
    client = TestClient(app)
    resp = client.get("/", headers={"Origin": "https://legacy.com"})
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "https://legacy.com"


# ============================================================================
# Test 7 - No callback = behaves exactly like parent
# ============================================================================

def test_no_callback_identical_to_parent():
    """Without allow_origin_func, DynamicCORSMiddleware == CORSMiddleware."""
    app = _make_app()
    app.add_middleware(
        DynamicCORSMiddleware,
        allow_origins=["https://example.com"],
        allow_methods=["GET"],
    )
    client = TestClient(app)

    # Allowed
    resp = client.get("/", headers={"Origin": "https://example.com"})
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "https://example.com"

    # Denied
    resp = client.get("/", headers={"Origin": "https://other.com"})
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") is None


# ============================================================================
# Test 8 - Dynamic function overrides static list
# ============================================================================

def test_dynamic_overrides_static_deny():
    """Dynamic 'deny' takes priority over static 'allow'."""
    app = _make_app()
    app.add_middleware(
        DynamicCORSMiddleware,
        allow_origin_func=lambda o: o != "https://blocked.example.com",
        allow_origins=["https://blocked.example.com", "https://ok.example.com"],
        allow_methods=["GET"],
    )
    client = TestClient(app)

    # Blocked by dynamic func even though in static list
    resp = client.get("/", headers={"Origin": "https://blocked.example.com"})
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") is None

    # Others still work
    resp = client.get("/", headers={"Origin": "https://ok.example.com"})
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "https://ok.example.com"
