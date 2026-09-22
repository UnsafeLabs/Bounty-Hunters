"""
Tests for the DynamicCORSMiddleware.

Covers:
- Dynamic allow via sync callback
- Dynamic deny via sync callback
- Async callback support
- Fallback to static allow_origins list when no callback is provided
- cors_max_age header in preflight responses
- Existing CORSMiddleware import is unaffected
"""

import pytest
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware, DynamicCORSMiddleware
from fastapi.testclient import TestClient


def create_app_with_dynamic_cors(
    allow_origin_func=None,
    allow_origins=None,
    cors_max_age=None,
    allow_credentials=False,
):
    """Helper to create a FastAPI app with DynamicCORSMiddleware."""
    app = FastAPI()

    @app.get("/data")
    async def get_data():
        return {"message": "hello"}

    @app.options("/data")
    async def preflight():
        return {"message": "preflight"}

    kwargs = {}
    if allow_origin_func is not None:
        kwargs["allow_origin_func"] = allow_origin_func
    if allow_origins is not None:
        kwargs["allow_origins"] = allow_origins
    if cors_max_age is not None:
        kwargs["cors_max_age"] = cors_max_age
    if allow_credentials:
        kwargs["allow_credentials"] = allow_credentials

    app.add_middleware(DynamicCORSMiddleware, **kwargs)
    return app


class TestDynamicCORSMiddleware:
    """Tests for DynamicCORSMiddleware."""

    def test_dynamic_allow_sync_callback(self):
        """A sync callback that returns True should allow the origin."""

        def allow_func(origin: str) -> bool:
            return origin == "https://trusted.example.com"

        app = create_app_with_dynamic_cors(allow_origin_func=allow_func)
        client = TestClient(app)

        # Allowed origin
        response = client.get(
            "/data",
            headers={"Origin": "https://trusted.example.com"},
        )
        assert response.status_code == 200
        assert response.headers.get("access-control-allow-origin") == "https://trusted.example.com"

        # Denied origin
        response = client.get(
            "/data",
            headers={"Origin": "https://evil.example.com"},
        )
        assert response.status_code == 200  # Passes through without CORS headers
        assert "access-control-allow-origin" not in response.headers

    def test_dynamic_deny_sync_callback(self):
        """A sync callback that returns False should deny the origin."""

        def deny_func(origin: str) -> bool:
            return False

        app = create_app_with_dynamic_cors(allow_origin_func=deny_func)
        client = TestClient(app)

        # Preflight with denied origin should get 403
        response = client.options(
            "/data",
            headers={
                "Origin": "https://any.example.com",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert response.status_code == 403

    def test_async_callback(self):
        """An async callback should be properly awaited."""

        async def async_allow_func(origin: str) -> bool:
            return origin.startswith("https://")

        app = create_app_with_dynamic_cors(allow_origin_func=async_allow_func)
        client = TestClient(app)

        # HTTPS origin allowed
        response = client.get(
            "/data",
            headers={"Origin": "https://good.example.com"},
        )
        assert response.status_code == 200
        assert response.headers.get("access-control-allow-origin") == "https://good.example.com"

        # HTTP origin denied
        response = client.get(
            "/data",
            headers={"Origin": "http://insecure.example.com"},
        )
        assert response.status_code == 200
        assert "access-control-allow-origin" not in response.headers

    def test_fallback_to_static_allow_origins(self):
        """When allow_origin_func is not provided, falls back to static list."""
        app = create_app_with_dynamic_cors(
            allow_origins=["https://static.example.com"]
        )
        client = TestClient(app)

        # Origin in static list
        response = client.get(
            "/data",
            headers={"Origin": "https://static.example.com"},
        )
        assert response.status_code == 200
        assert response.headers.get("access-control-allow-origin") == "https://static.example.com"

        # Origin not in static list
        response = client.get(
            "/data",
            headers={"Origin": "https://other.example.com"},
        )
        assert response.status_code == 200
        assert "access-control-allow-origin" not in response.headers

    def test_fallback_wildcard(self):
        """When allow_origins is ['*'] and no callback, all origins allowed."""
        app = create_app_with_dynamic_cors(allow_origins=["*"])
        client = TestClient(app)

        response = client.get(
            "/data",
            headers={"Origin": "https://anything.example.com"},
        )
        assert response.status_code == 200
        assert response.headers.get("access-control-allow-origin") == "*"

    def test_cors_max_age_in_preflight(self):
        """The cors_max_age parameter should set Access-Control-Max-Age in preflight."""

        def allow_all(origin: str) -> bool:
            return True

        app = create_app_with_dynamic_cors(
            allow_origin_func=allow_all,
            cors_max_age=3600,
        )
        client = TestClient(app)

        response = client.options(
            "/data",
            headers={
                "Origin": "https://test.example.com",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert response.status_code == 200
        assert response.headers.get("access-control-max-age") == "3600"

    def test_cors_max_age_takes_precedence_over_max_age(self):
        """cors_max_age should take precedence over max_age."""

        def allow_all(origin: str) -> bool:
            return True

        app = FastAPI()

        @app.get("/data")
        async def get_data():
            return {"message": "hello"}

        app.add_middleware(
            DynamicCORSMiddleware,
            allow_origin_func=allow_all,
            max_age=600,
            cors_max_age=7200,
        )
        client = TestClient(app)

        response = client.options(
            "/data",
            headers={
                "Origin": "https://test.example.com",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert response.status_code == 200
        assert response.headers.get("access-control-max-age") == "7200"

    def test_no_max_age_header_when_not_set(self):
        """Access-Control-Max-Age should not be present when not configured."""

        def allow_all(origin: str) -> bool:
            return True

        app = create_app_with_dynamic_cors(allow_origin_func=allow_all)
        client = TestClient(app)

        response = client.options(
            "/data",
            headers={
                "Origin": "https://test.example.com",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert response.status_code == 200
        assert "access-control-max-age" not in response.headers

    def test_allow_credentials_header(self):
        """When allow_credentials is True, the header should be set."""

        def allow_all(origin: str) -> bool:
            return True

        app = create_app_with_dynamic_cors(
            allow_origin_func=allow_all,
            allow_credentials=True,
        )
        client = TestClient(app)

        response = client.get(
            "/data",
            headers={"Origin": "https://test.example.com"},
        )
        assert response.status_code == 200
        assert response.headers.get("access-control-allow-credentials") == "true"

    def test_no_origin_header_passes_through(self):
        """Requests without an Origin header should pass through normally."""
        app = create_app_with_dynamic_cors(
            allow_origin_func=lambda o: False
        )
        client = TestClient(app)

        response = client.get("/data")
        assert response.status_code == 200
        assert response.json() == {"message": "hello"}


class TestExistingCORSMiddlewareUnaffected:
    """Verify that the existing CORSMiddleware import and behavior is unchanged."""

    def test_cors_middleware_import(self):
        """CORSMiddleware should still be importable from fastapi.middleware.cors."""
        from fastapi.middleware.cors import CORSMiddleware as CM

        assert CM is not None

    def test_cors_middleware_basic_functionality(self):
        """Standard CORSMiddleware should still work as before."""
        app = FastAPI()

        @app.get("/data")
        async def get_data():
            return {"message": "hello"}

        app.add_middleware(
            CORSMiddleware,
            allow_origins=["https://allowed.example.com"],
            allow_methods=["GET"],
            allow_headers=["*"],
        )
        client = TestClient(app)

        response = client.get(
            "/data",
            headers={"Origin": "https://allowed.example.com"},
        )
        assert response.status_code == 200
        assert response.headers.get("access-control-allow-origin") == "https://allowed.example.com"

    def test_dynamic_cors_middleware_import(self):
        """DynamicCORSMiddleware should be importable."""
        from fastapi.middleware.cors import DynamicCORSMiddleware as DCM

        assert DCM is not None
