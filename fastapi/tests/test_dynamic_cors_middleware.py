from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware, DynamicCORSMiddleware
from fastapi.testclient import TestClient
from starlette.middleware.cors import CORSMiddleware as StarletteCORSMiddleware


def create_app(**cors_options):
    app = FastAPI()
    app.add_middleware(DynamicCORSMiddleware, **cors_options)

    @app.get("/")
    def read_root():
        return {"message": "ok"}

    return app


def test_existing_cors_middleware_export_is_unchanged():
    assert CORSMiddleware is StarletteCORSMiddleware


def test_dynamic_cors_allows_origin_from_sync_callback():
    origins_seen = []

    def allow_origin(origin: str) -> bool:
        origins_seen.append(origin)
        return origin == "https://allowed.example.com"

    client = TestClient(create_app(allow_origin_func=allow_origin))

    response = client.get("/", headers={"Origin": "https://allowed.example.com"})

    assert response.status_code == 200, response.text
    assert response.headers["access-control-allow-origin"] == (
        "https://allowed.example.com"
    )
    assert origins_seen == ["https://allowed.example.com"]


def test_dynamic_cors_denies_origin_from_sync_callback():
    client = TestClient(
        create_app(
            allow_origins=["*"],
            allow_origin_func=lambda origin: origin == "https://allowed.example.com",
        )
    )

    response = client.get("/", headers={"Origin": "https://blocked.example.com"})

    assert response.status_code == 200, response.text
    assert "access-control-allow-origin" not in response.headers


def test_dynamic_cors_awaits_async_callback():
    async def allow_origin(origin: str) -> bool:
        return origin == "https://async.example.com"

    client = TestClient(create_app(allow_origin_func=allow_origin))

    response = client.get("/", headers={"Origin": "https://async.example.com"})

    assert response.status_code == 200, response.text
    assert response.headers["access-control-allow-origin"] == (
        "https://async.example.com"
    )


def test_dynamic_cors_falls_back_to_static_origins_without_callback():
    client = TestClient(create_app(allow_origins=["https://static.example.com"]))

    allowed_response = client.get("/", headers={"Origin": "https://static.example.com"})
    denied_response = client.get("/", headers={"Origin": "https://blocked.example.com"})

    assert allowed_response.status_code == 200, allowed_response.text
    assert allowed_response.headers["access-control-allow-origin"] == (
        "https://static.example.com"
    )
    assert denied_response.status_code == 200, denied_response.text
    assert "access-control-allow-origin" not in denied_response.headers


def test_dynamic_cors_sets_cors_max_age_on_preflight_response():
    client = TestClient(
        create_app(
            allow_methods=["GET"],
            allow_origin_func=lambda origin: origin == "https://allowed.example.com",
            cors_max_age=123,
        )
    )

    response = client.options(
        "/",
        headers={
            "Origin": "https://allowed.example.com",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200, response.text
    assert response.headers["access-control-allow-origin"] == (
        "https://allowed.example.com"
    )
    assert response.headers["access-control-max-age"] == "123"


def test_dynamic_cors_denies_preflight_from_callback():
    client = TestClient(
        create_app(
            allow_methods=["GET"],
            allow_origin_func=lambda origin: origin == "https://allowed.example.com",
        )
    )

    response = client.options(
        "/",
        headers={
            "Origin": "https://blocked.example.com",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 400, response.text
    assert response.text == "Disallowed CORS origin"
    assert "access-control-allow-origin" not in response.headers
