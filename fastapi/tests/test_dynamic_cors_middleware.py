from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware, DynamicCORSMiddleware
from fastapi.testclient import TestClient
from starlette.middleware.cors import CORSMiddleware as StarletteCORSMiddleware


def create_app(**cors_options):
    app = FastAPI()
    app.add_middleware(DynamicCORSMiddleware, **cors_options)

    @app.get("/")
    def read_root():
        return {"ok": True}

    return app


def test_existing_corsmiddleware_export_is_unchanged():
    assert CORSMiddleware is StarletteCORSMiddleware


def test_dynamic_cors_allows_origin_from_sync_callback():
    seen_origins: list[str] = []

    def allow_origin(origin: str) -> bool:
        seen_origins.append(origin)
        return origin == "https://allowed.example"

    client = TestClient(create_app(allow_origin_func=allow_origin))

    response = client.get("/", headers={"Origin": "https://allowed.example"})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://allowed.example"
    assert seen_origins == ["https://allowed.example"]


def test_dynamic_cors_denies_origin_from_sync_callback():
    client = TestClient(create_app(allow_origin_func=lambda origin: False))

    response = client.get("/", headers={"Origin": "https://denied.example"})

    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


def test_dynamic_cors_awaits_async_callback_for_preflight():
    async def allow_origin(origin: str) -> bool:
        return origin == "https://async.example"

    client = TestClient(
        create_app(
            allow_origin_func=allow_origin,
            allow_methods=["GET"],
            cors_max_age=123,
        )
    )

    response = client.options(
        "/",
        headers={
            "Origin": "https://async.example",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://async.example"
    assert response.headers["access-control-max-age"] == "123"


def test_dynamic_cors_falls_back_to_static_origins_without_callback():
    client = TestClient(
        create_app(
            allow_origins=["https://static.example"],
            allow_methods=["POST"],
            cors_max_age=321,
        )
    )

    response = client.options(
        "/",
        headers={
            "Origin": "https://static.example",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://static.example"
    assert response.headers["access-control-max-age"] == "321"
