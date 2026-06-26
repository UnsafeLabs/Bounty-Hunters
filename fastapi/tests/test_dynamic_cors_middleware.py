import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware, DynamicCORSMiddleware
from fastapi.testclient import TestClient
from starlette.middleware.cors import CORSMiddleware as StarletteCORSMiddleware


def make_app(**middleware_options) -> FastAPI:
    app = FastAPI()
    app.add_middleware(DynamicCORSMiddleware, **middleware_options)

    @app.get("/")
    def read_root():
        return {"ok": True}

    return app


def test_existing_cors_middleware_export_is_unchanged():
    assert CORSMiddleware is StarletteCORSMiddleware


def test_dynamic_cors_allows_origin_with_sync_callback():
    client = TestClient(
        make_app(
            allow_origin_func=lambda origin: origin.endswith(".example.com"),
            allow_methods=["GET"],
        )
    )

    response = client.get("/", headers={"Origin": "https://api.example.com"})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == (
        "https://api.example.com"
    )
    assert response.headers["vary"] == "Origin"


def test_dynamic_cors_denies_origin_with_sync_callback():
    client = TestClient(
        make_app(
            allow_origin_func=lambda origin: origin.endswith(".example.com"),
            allow_origins=["*"],
            allow_methods=["GET"],
        )
    )

    response = client.get("/", headers={"Origin": "https://blocked.test"})

    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


def test_dynamic_cors_awaits_async_callback_for_preflight():
    async def allow_origin(origin: str) -> bool:
        await asyncio.sleep(0)
        return origin == "https://async.example.com"

    client = TestClient(
        make_app(
            allow_origin_func=allow_origin,
            allow_methods=["GET"],
            cors_max_age=321,
        )
    )

    response = client.options(
        "/",
        headers={
            "Origin": "https://async.example.com",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == (
        "https://async.example.com"
    )
    assert response.headers["access-control-max-age"] == "321"


def test_dynamic_cors_rejects_denied_preflight_origin():
    client = TestClient(
        make_app(
            allow_origin_func=lambda origin: False,
            allow_origins=["*"],
            allow_methods=["GET"],
        )
    )

    response = client.options(
        "/",
        headers={
            "Origin": "https://blocked.test",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 400
    assert response.text == "Disallowed CORS origin"
    assert "access-control-allow-origin" not in response.headers
    assert response.headers["vary"] == "Origin"


def test_dynamic_cors_falls_back_to_static_allow_origins_without_callback():
    client = TestClient(
        make_app(
            allow_origins=["https://static.example.com"],
            allow_methods=["GET"],
            cors_max_age=654,
        )
    )

    response = client.options(
        "/",
        headers={
            "Origin": "https://static.example.com",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == (
        "https://static.example.com"
    )
    assert response.headers["access-control-max-age"] == "654"
