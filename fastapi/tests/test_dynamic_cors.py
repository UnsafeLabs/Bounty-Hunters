from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware, DynamicCORSMiddleware
from fastapi.testclient import TestClient
from starlette.middleware.cors import CORSMiddleware as StarletteCORSMiddleware


def build_client(**middleware_kwargs):
    app = FastAPI()
    app.add_middleware(DynamicCORSMiddleware, **middleware_kwargs)

    @app.get("/")
    def read_root():
        return {"message": "ok"}

    return TestClient(app)


def test_existing_cors_middleware_export_unchanged():
    assert CORSMiddleware is StarletteCORSMiddleware


def test_dynamic_cors_allows_origin_and_sets_cors_max_age():
    client = build_client(
        allow_origin_func=lambda origin: origin.endswith(".example.com"),
        allow_methods=["GET"],
        allow_headers=["X-Token"],
        cors_max_age=123,
    )

    response = client.get("/", headers={"Origin": "https://api.example.com"})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == (
        "https://api.example.com"
    )
    assert response.headers["vary"] == "Origin"

    response = client.options(
        "/",
        headers={
            "Origin": "https://api.example.com",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "X-Token",
        },
    )
    assert response.status_code == 200
    assert response.text == "OK"
    assert response.headers["access-control-allow-origin"] == (
        "https://api.example.com"
    )
    assert response.headers["access-control-max-age"] == "123"


def test_dynamic_cors_denies_origin():
    client = build_client(
        allow_origin_func=lambda origin: origin == "https://allowed.example.com",
        allow_methods=["GET"],
    )

    response = client.get("/", headers={"Origin": "https://evil.example.com"})
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers

    response = client.options(
        "/",
        headers={
            "Origin": "https://evil.example.com",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.status_code == 400
    assert response.text == "Disallowed CORS origin"
    assert "access-control-allow-origin" not in response.headers


def test_dynamic_cors_awaits_async_callback():
    async def allow_origin(origin: str) -> bool:
        return origin == "https://async.example.com"

    client = build_client(allow_origin_func=allow_origin, allow_methods=["GET"])

    response = client.get("/", headers={"Origin": "https://async.example.com"})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == (
        "https://async.example.com"
    )


def test_dynamic_cors_falls_back_to_static_origins_without_callback():
    client = build_client(
        allow_origins=["https://static.example.com"],
        allow_methods=["GET"],
    )

    response = client.get("/", headers={"Origin": "https://static.example.com"})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == (
        "https://static.example.com"
    )

    response = client.get("/", headers={"Origin": "https://blocked.example.com"})
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers
