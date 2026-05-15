from fastapi import FastAPI
from fastapi.middleware.cors import DynamicCORSMiddleware
from fastapi.testclient import TestClient


def create_app(**middleware_kwargs: object) -> FastAPI:
    app = FastAPI()
    app.add_middleware(
        DynamicCORSMiddleware,
        allow_methods=["*"],
        allow_headers=["*"],
        **middleware_kwargs,
    )

    @app.get("/ping")
    async def ping() -> dict[str, str]:
        return {"ok": "true"}

    return app


def test_dynamic_allow_origin() -> None:
    app = create_app(allow_origin_func=lambda origin: origin == "https://allowed.example")
    client = TestClient(app)
    response = client.get("/ping", headers={"Origin": "https://allowed.example"})
    assert response.headers["access-control-allow-origin"] == "https://allowed.example"


def test_dynamic_deny_origin() -> None:
    app = create_app(allow_origin_func=lambda origin: origin == "https://allowed.example")
    client = TestClient(app)
    response = client.get("/ping", headers={"Origin": "https://denied.example"})
    assert "access-control-allow-origin" not in response.headers


def test_async_allow_origin_callback() -> None:
    async def allow_origin(origin: str) -> bool:
        return origin == "https://async.example"

    app = create_app(allow_origin_func=allow_origin)
    client = TestClient(app)
    response = client.get("/ping", headers={"Origin": "https://async.example"})
    assert response.headers["access-control-allow-origin"] == "https://async.example"


def test_fallback_to_static_allow_origins() -> None:
    app = create_app(allow_origins=["https://static.example"])
    client = TestClient(app)
    response = client.get("/ping", headers={"Origin": "https://static.example"})
    assert response.headers["access-control-allow-origin"] == "https://static.example"


def test_cors_max_age_used_in_preflight() -> None:
    app = create_app(
        allow_origin_func=lambda origin: origin == "https://allowed.example",
        cors_max_age=1234,
    )
    client = TestClient(app)
    response = client.options(
        "/ping",
        headers={
            "Origin": "https://allowed.example",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-max-age"] == "1234"
