from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware, DynamicCORSMiddleware
from fastapi.testclient import TestClient


def create_app(
    middleware_class: type[Any] = DynamicCORSMiddleware,
    **middleware_kwargs: Any,
) -> FastAPI:
    app = FastAPI()

    @app.get("/")
    def read_root() -> dict[str, str]:
        return {"message": "ok"}

    app.add_middleware(middleware_class, **middleware_kwargs)  # type: ignore[arg-type]
    return app


def test_existing_cors_middleware_export_is_unchanged() -> None:
    app = create_app(
        middleware_class=CORSMiddleware,
        allow_origins=["https://allowed.example"],
    )
    client = TestClient(app)

    response = client.get("/", headers={"Origin": "https://allowed.example"})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://allowed.example"


def test_dynamic_cors_allows_origin_with_sync_callback() -> None:
    seen_origins = []

    def allow_origin(origin: str) -> bool:
        seen_origins.append(origin)
        return origin == "https://allowed.example"

    app = create_app(allow_origin_func=allow_origin)
    client = TestClient(app)

    response = client.get("/", headers={"Origin": "https://allowed.example"})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://allowed.example"
    assert response.headers["vary"] == "Origin"
    assert seen_origins == ["https://allowed.example"]


def test_dynamic_cors_denies_origin_with_sync_callback() -> None:
    def allow_origin(origin: str) -> bool:
        return False

    app = create_app(allow_origin_func=allow_origin)
    client = TestClient(app)

    response = client.get("/", headers={"Origin": "https://blocked.example"})

    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


def test_dynamic_cors_supports_async_callback() -> None:
    async def allow_origin(origin: str) -> bool:
        return origin.endswith(".example")

    app = create_app(allow_origin_func=allow_origin)
    client = TestClient(app)

    response = client.options(
        "/",
        headers={
            "Origin": "https://api.example",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://api.example"


def test_dynamic_cors_falls_back_to_static_origins_without_callback() -> None:
    app = create_app(allow_origins=["https://static.example"])
    client = TestClient(app)

    response = client.get("/", headers={"Origin": "https://static.example"})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://static.example"


def test_dynamic_cors_preflight_uses_cors_max_age() -> None:
    def allow_origin(origin: str) -> bool:
        return origin == "https://allowed.example"

    app = create_app(
        allow_origin_func=allow_origin,
        allow_methods=["GET", "POST"],
        cors_max_age=3600,
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
    assert response.headers["access-control-allow-origin"] == "https://allowed.example"
    assert response.headers["access-control-max-age"] == "3600"


def test_dynamic_cors_preflight_denies_origin() -> None:
    def allow_origin(origin: str) -> bool:
        return False

    app = create_app(allow_origin_func=allow_origin)
    client = TestClient(app)

    response = client.options(
        "/",
        headers={
            "Origin": "https://blocked.example",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 400
    assert response.text == "Disallowed CORS origin"
    assert "access-control-allow-origin" not in response.headers
