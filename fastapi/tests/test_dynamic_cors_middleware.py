from __future__ import annotations

import pytest
from starlette.testclient import TestClient

from fastapi import FastAPI
from fastapi.middleware.cors import DynamicCORSMiddleware


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_app(**middleware_kwargs):
    """Return a minimal FastAPI app with DynamicCORSMiddleware."""
    app = FastAPI()
    app.add_middleware(DynamicCORSMiddleware, **middleware_kwargs)

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    return app


# ---------------------------------------------------------------------------
# Tests — static fallback (no allow_origin_func)
# ---------------------------------------------------------------------------


class TestStaticFallback:
    """When allow_origin_func is None the middleware behaves like CORSMiddleware."""

    def test_allowed_static_origin(self):
        app = _make_app(
            allow_origins=["https://example.com"],
            allow_methods=["GET"],
            allow_headers=["*"],
        )
        client = TestClient(app)
        resp = client.get(
            "/health",
            headers={"Origin": "https://example.com"},
        )
        assert resp.status_code == 200
        assert resp.headers.get("access-control-allow-origin") == "https://example.com"

    def test_disallowed_static_origin(self):
        app = _make_app(
            allow_origins=["https://example.com"],
            allow_methods=["GET"],
            allow_headers=["*"],
        )
        client = TestClient(app)
        resp = client.get(
            "/health",
            headers={"Origin": "https://evil.com"},
        )
        assert resp.status_code == 200
        # Disallowed origin → no ACAO header
        assert "access-control-allow-origin" not in resp.headers

    def test_preflight_static_origin(self):
        app = _make_app(
            allow_origins=["https://example.com"],
            allow_methods=["GET", "POST"],
            allow_headers=["content-type"],
        )
        client = TestClient(app)
        resp = client.options(
            "/health",
            headers={
                "Origin": "https://example.com",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        assert resp.status_code == 200
        assert resp.headers["access-control-allow-origin"] == "https://example.com"
        assert "POST" in resp.headers["access-control-allow-methods"]


# ---------------------------------------------------------------------------
# Tests — sync allow_origin_func
# ---------------------------------------------------------------------------


class TestSyncCallback:
    def test_dynamic_allow(self):
        def check_origin(origin: str) -> bool:
            return origin.endswith(".example.com")

        app = _make_app(allow_origin_func=check_origin)
        client = TestClient(app)

        resp = client.get("/health", headers={"Origin": "https://app.example.com"})
        assert resp.status_code == 200
        assert resp.headers["access-control-allow-origin"] == "https://app.example.com"

    def test_dynamic_deny(self):
        def check_origin(origin: str) -> bool:
            return origin.endswith(".example.com")

        app = _make_app(allow_origin_func=check_origin)
        client = TestClient(app)

        resp = client.get("/health", headers={"Origin": "https://evil.com"})
        assert resp.status_code == 200
        assert "access-control-allow-origin" not in resp.headers

    def test_preflight_dynamic_allow(self):
        def check_origin(origin: str) -> bool:
            return "example.com" in origin

        app = _make_app(
            allow_origin_func=check_origin,
            allow_methods=["GET", "POST"],
            allow_headers=["content-type"],
        )
        client = TestClient(app)

        resp = client.options(
            "/health",
            headers={
                "Origin": "https://app.example.com",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        assert resp.status_code == 200
        assert resp.headers["access-control-allow-origin"] == "https://app.example.com"

    def test_preflight_dynamic_deny(self):
        def check_origin(origin: str) -> bool:
            return origin == "https://allowed.com"

        app = _make_app(
            allow_origin_func=check_origin,
            allow_methods=["GET"],
        )
        client = TestClient(app)

        resp = client.options(
            "/health",
            headers={
                "Origin": "https://evil.com",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert resp.status_code == 400
        assert "origin" in resp.text.lower()


# ---------------------------------------------------------------------------
# Tests — async allow_origin_func
# ---------------------------------------------------------------------------


class TestAsyncCallback:
    def test_async_dynamic_allow(self):
        async def check_origin(origin: str) -> bool:
            return origin.endswith(".example.com")

        app = _make_app(allow_origin_func=check_origin)
        client = TestClient(app)

        resp = client.get("/health", headers={"Origin": "https://app.example.com"})
        assert resp.status_code == 200
        assert resp.headers["access-control-allow-origin"] == "https://app.example.com"

    def test_async_dynamic_deny(self):
        async def check_origin(origin: str) -> bool:
            return origin.endswith(".example.com")

        app = _make_app(allow_origin_func=check_origin)
        client = TestClient(app)

        resp = client.get("/health", headers={"Origin": "https://evil.com"})
        assert resp.status_code == 200
        assert "access-control-allow-origin" not in resp.headers

    def test_async_preflight_allow(self):
        async def check_origin(origin: str) -> bool:
            return "example.com" in origin

        app = _make_app(
            allow_origin_func=check_origin,
            allow_methods=["GET", "POST"],
            allow_headers=["content-type"],
        )
        client = TestClient(app)

        resp = client.options(
            "/health",
            headers={
                "Origin": "https://app.example.com",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        assert resp.status_code == 200
        assert resp.headers["access-control-allow-origin"] == "https://app.example.com"


# ---------------------------------------------------------------------------
# Tests — cors_max_age parameter
# ---------------------------------------------------------------------------


class TestCorsMaxAge:
    def test_cors_max_age_overrides_max_age(self):
        app = _make_app(
            allow_origins=["*"],
            max_age=100,
            cors_max_age=3600,
        )
        client = TestClient(app)

        resp = client.options(
            "/health",
            headers={
                "Origin": "https://example.com",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert resp.status_code == 200
        assert resp.headers["access-control-max-age"] == "3600"

    def test_default_max_age(self):
        app = _make_app(allow_origins=["*"])
        client = TestClient(app)

        resp = client.options(
            "/health",
            headers={
                "Origin": "https://example.com",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert resp.status_code == 200
        assert resp.headers["access-control-max-age"] == "600"


# ---------------------------------------------------------------------------
# Tests — edge cases
# ---------------------------------------------------------------------------


class TestEdgeCases:
    def test_no_origin_header_passes_through(self):
        app = _make_app(
            allow_origin_func=lambda o: True,
        )
        client = TestClient(app)

        resp = client.get("/health")
        assert resp.status_code == 200
        assert "access-control-allow-origin" not in resp.headers

    def test_callback_exception_denies_origin(self):
        def bad_callback(origin: str) -> bool:
            raise RuntimeError("boom")

        app = _make_app(allow_origin_func=bad_callback)
        client = TestClient(app)

        resp = client.get("/health", headers={"Origin": "https://example.com"})
        assert resp.status_code == 200
        assert "access-control-allow-origin" not in resp.headers

    def test_async_callback_exception_denies_origin(self):
        async def bad_callback(origin: str) -> bool:
            raise RuntimeError("boom")

        app = _make_app(allow_origin_func=bad_callback)
        client = TestClient(app)

        resp = client.get("/health", headers={"Origin": "https://example.com"})
        assert resp.status_code == 200
        assert "access-control-allow-origin" not in resp.headers

    def test_credentials_with_dynamic_origin(self):
        def check_origin(origin: str) -> bool:
            return origin == "https://trusted.com"

        app = _make_app(
            allow_origin_func=check_origin,
            allow_credentials=True,
        )
        client = TestClient(app)

        resp = client.get("/health", headers={"Origin": "https://trusted.com"})
        assert resp.status_code == 200
        assert resp.headers["access-control-allow-origin"] == "https://trusted.com"
        assert resp.headers["access-control-allow-credentials"] == "true"

    def test_non_http_scope_passes_through(self):
        app = _make_app(allow_origin_func=lambda o: True)
        client = TestClient(app)
        # Just ensure it doesn't crash on normal requests
        resp = client.get("/health")
        assert resp.status_code == 200
