from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware, DynamicCORSMiddleware
from fastapi.testclient import TestClient
from starlette.middleware.cors import CORSMiddleware as StarletteCORSMiddleware


def create_app(**middleware_options: object) -> FastAPI:
    app = FastAPI()
    app.add_middleware(DynamicCORSMiddleware, **middleware_options)

    @app.get("/")
    def read_root() -> dict[str, bool]:
        return {"ok": True}

    return app


def test_existing_cors_middleware_export_is_unchanged() -> None:
    assert CORSMiddleware is StarletteCORSMiddleware


def test_dynamic_cors_allows_origin_from_sync_callback() -> None:
    seen_origins: list[str] = []

    def allow_origin(origin: str) -> bool:
        seen_origins.append(origin)
        return origin == "https://allowed.example"

    app = create_app(allow_origin_func=allow_origin)
    client = TestClient(app)

    response = client.get("/", headers={"Origin": "https://allowed.example"})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == (
        "https://allowed.example"
    )
    assert seen_origins == ["https://allowed.example"]


def test_dynamic_cors_denies_origin_from_sync_callback() -> None:
    app = create_app(allow_origin_func=lambda origin: False)
    client = TestClient(app)

    response = client.get("/", headers={"Origin": "https://denied.example"})

    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


def test_dynamic_cors_awaits_async_callback() -> None:
    async def allow_origin(origin: str) -> bool:
        return origin.endswith(".example")

    app = create_app(allow_origin_func=allow_origin)
    client = TestClient(app)

    response = client.get("/", headers={"Origin": "https://api.example"})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://api.example"


def test_dynamic_cors_falls_back_to_static_allow_origins_without_callback() -> None:
    app = create_app(allow_origins=["https://static.example"])
    client = TestClient(app)

    response = client.get("/", headers={"Origin": "https://static.example"})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://static.example"


def test_dynamic_cors_sets_cors_max_age_on_preflight_response() -> None:
    app = create_app(
        allow_origin_func=lambda origin: origin == "https://allowed.example",
        allow_methods=["GET", "POST"],
        cors_max_age=1234,
    )
    client = TestClient(app)

    response = client.options(
        "/",
        headers={
            "Origin": "https://allowed.example",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == (
        "https://allowed.example"
    )
    assert response.headers["access-control-max-age"] == "1234"
