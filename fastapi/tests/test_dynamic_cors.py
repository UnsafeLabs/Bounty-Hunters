from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware, DynamicCORSMiddleware
from fastapi.testclient import TestClient


def create_app(**middleware_kwargs) -> FastAPI:
    app = FastAPI()
    app.add_middleware(DynamicCORSMiddleware, **middleware_kwargs)

    @app.get("/")
    def read_root() -> dict[str, bool]:
        return {"ok": True}

    @app.post("/")
    def write_root() -> dict[str, bool]:
        return {"ok": True}

    return app


def test_existing_corsmiddleware_export_is_unchanged() -> None:
    assert CORSMiddleware is not DynamicCORSMiddleware


def test_dynamic_cors_allows_origin_from_sync_callback() -> None:
    seen_origins: list[str] = []

    def allow_origin(origin: str) -> bool:
        seen_origins.append(origin)
        return origin.endswith(".example.com")

    app = create_app(allow_origin_func=allow_origin)
    response = TestClient(app).get("/", headers={"Origin": "https://api.example.com"})

    assert seen_origins == ["https://api.example.com"]
    assert response.headers["access-control-allow-origin"] == (
        "https://api.example.com"
    )
    assert response.headers["vary"] == "Origin"


def test_dynamic_cors_denies_origin_even_when_static_wildcard_is_configured() -> None:
    app = create_app(
        allow_origin_func=lambda origin: False,
        allow_origins=["*"],
    )
    response = TestClient(app).get("/", headers={"Origin": "https://blocked.test"})

    assert "access-control-allow-origin" not in response.headers


def test_dynamic_cors_awaits_async_callback_for_preflight() -> None:
    seen_origins: list[str] = []

    async def allow_origin(origin: str) -> bool:
        seen_origins.append(origin)
        return origin == "https://allowed.test"

    app = create_app(
        allow_origin_func=allow_origin,
        allow_methods=["POST"],
        allow_headers=["x-token"],
        cors_max_age=123,
    )
    response = TestClient(app).options(
        "/",
        headers={
            "Origin": "https://allowed.test",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "x-token",
        },
    )

    assert seen_origins == ["https://allowed.test"]
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://allowed.test"
    assert response.headers["access-control-max-age"] == "123"


def test_dynamic_cors_awaits_async_callback_for_simple_response() -> None:
    async def allow_origin(origin: str) -> bool:
        return origin == "https://simple.test"

    app = create_app(allow_origin_func=allow_origin)
    response = TestClient(app).get("/", headers={"Origin": "https://simple.test"})

    assert response.headers["access-control-allow-origin"] == "https://simple.test"


def test_dynamic_cors_denies_preflight_origin() -> None:
    app = create_app(
        allow_origin_func=lambda origin: False,
        allow_methods=["POST"],
        cors_max_age=321,
    )
    response = TestClient(app).options(
        "/",
        headers={
            "Origin": "https://blocked.test",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 400
    assert response.text == "Disallowed CORS origin"
    assert "access-control-allow-origin" not in response.headers
    assert response.headers["access-control-max-age"] == "321"


def test_dynamic_cors_falls_back_to_static_allow_origins() -> None:
    app = create_app(allow_origins=["https://static.test"])
    response = TestClient(app).get("/", headers={"Origin": "https://static.test"})

    assert response.headers["access-control-allow-origin"] == "https://static.test"


def test_dynamic_cors_static_wildcard_behaves_like_starlette_cors() -> None:
    app = create_app(allow_origins=["*"])
    response = TestClient(app).get("/", headers={"Origin": "https://any.test"})

    assert response.headers["access-control-allow-origin"] == "*"
