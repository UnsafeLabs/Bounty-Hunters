"""Tests for DynamicCORSMiddleware."""

import pytest
from fastapi import FastAPI
from fastapi.middleware.dynamic_cors import DynamicCORSMiddleware
from starlette.testclient import TestClient


def test_static_fallback():
    """When no callback is provided, falls back to static origins."""
    app = FastAPI()
    app.add_middleware(
        DynamicCORSMiddleware,
        allow_origins=["https://example.com"],
    )

    @app.get("/")
    async def root():
        return {"msg": "ok"}

    client = TestClient(app)
    response = client.get("/", headers={"origin": "https://example.com"})
    assert response.status_code == 200
    assert "access-control-allow-origin" in response.headers


def test_dynamic_allow():
    """Callback returning True allows the origin."""
    app = FastAPI()
    app.add_middleware(
        DynamicCORSMiddleware,
        allow_origin_func=lambda origin: origin.endswith(".example.com"),
    )

    @app.get("/")
    async def root():
        return {"msg": "ok"}

    client = TestClient(app)
    response = client.get("/", headers={"origin": "https://app.example.com"})
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "https://app.example.com"


def test_dynamic_deny():
    """Callback returning False rejects the origin."""
    app = FastAPI()
    app.add_middleware(
        DynamicCORSMiddleware,
        allow_origin_func=lambda origin: origin.endswith(".example.com"),
    )

    @app.get("/")
    async def root():
        return {"msg": "ok"}

    client = TestClient(app)
    response = client.get("/", headers={"origin": "https://evil.com"})
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


def test_async_callback():
    """Async callback is properly awaited."""
    app = FastAPI()

    async def check_origin(origin: str) -> bool:
        return origin == "https://trusted.com"

    app.add_middleware(
        DynamicCORSMiddleware,
        allow_origin_func=check_origin,
    )

    @app.get("/")
    async def root():
        return {"msg": "ok"}

    client = TestClient(app)
    response = client.get("/", headers={"origin": "https://trusted.com"})
    assert response.status_code == 200

    response = client.get("/", headers={"origin": "https://untrusted.com"})
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


def test_cors_max_age():
    """Preflight response includes Access-Control-Max-Age header."""
    app = FastAPI()
    app.add_middleware(
        DynamicCORSMiddleware,
        allow_origins=["*"],
        cors_max_age=3600,
    )

    @app.get("/")
    async def root():
        return {"msg": "ok"}

    client = TestClient(app)
    response = client.options(
        "/",
        headers={
            "origin": "https://example.com",
            "access-control-request-method": "GET",
        },
    )
    assert response.headers.get("access-control-max-age") == "3600"


def test_preflight_dynamic_allow():
    """Preflight request with allowed origin returns CORS headers."""
    app = FastAPI()
    app.add_middleware(
        DynamicCORSMiddleware,
        allow_origin_func=lambda origin: origin == "https://good.com",
    )

    @app.get("/")
    async def root():
        return {"msg": "ok"}

    client = TestClient(app)
    response = client.options(
        "/",
        headers={
            "origin": "https://good.com",
            "access-control-request-method": "GET",
        },
    )
    assert response.status_code == 200


def test_no_origin_header():
    """Request without Origin header passes through normally."""
    app = FastAPI()
    app.add_middleware(
        DynamicCORSMiddleware,
        allow_origin_func=lambda origin: True,
    )

    @app.get("/")
    async def root():
        return {"msg": "ok"}

    client = TestClient(app)
    response = client.get("/")
    assert response.status_code == 200
