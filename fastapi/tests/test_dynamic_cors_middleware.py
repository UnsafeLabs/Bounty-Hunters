from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware, DynamicCORSMiddleware
from fastapi.testclient import TestClient
from starlette.middleware.cors import CORSMiddleware as StarletteCORSMiddleware


def create_client(**middleware_options):
    app = FastAPI()
    app.add_middleware(DynamicCORSMiddleware, **middleware_options)

    @app.get("/")
    def read_root():
        return {"ok": True}

    return TestClient(app)


def preflight(client: TestClient, origin: str):
    return client.options(
        "/",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
        },
    )


def test_dynamic_cors_middleware_allows_origin_from_sync_callback():
    client = create_client(
        allow_origin_func=lambda origin: origin == "https://allowed.example"
    )

    response = client.get("/", headers={"Origin": "https://allowed.example"})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://allowed.example"


def test_dynamic_cors_middleware_denies_origin_from_sync_callback():
    client = create_client(allow_origin_func=lambda origin: False)

    response = preflight(client, "https://denied.example")

    assert response.status_code == 400
    assert response.text == "Disallowed CORS origin"
    assert "access-control-allow-origin" not in response.headers


def test_dynamic_cors_middleware_awaits_async_callback():
    seen_origins = []

    async def allow_origin(origin: str) -> bool:
        seen_origins.append(origin)
        return origin.endswith(".example")

    client = create_client(allow_origin_func=allow_origin)

    response = preflight(client, "https://tenant.example")

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://tenant.example"
    assert seen_origins == ["https://tenant.example"]


def test_dynamic_cors_middleware_falls_back_to_static_origins_without_callback():
    client = create_client(allow_origins=["https://static.example"])

    response = client.get("/", headers={"Origin": "https://static.example"})
    denied = client.get("/", headers={"Origin": "https://other.example"})

    assert response.headers["access-control-allow-origin"] == "https://static.example"
    assert "access-control-allow-origin" not in denied.headers


def test_dynamic_cors_middleware_sets_cors_max_age_for_preflight():
    client = create_client(
        allow_origin_func=lambda origin: True,
        cors_max_age=123,
    )

    response = preflight(client, "https://allowed.example")

    assert response.status_code == 200
    assert response.headers["access-control-max-age"] == "123"


def test_dynamic_cors_middleware_preserves_existing_cors_export():
    assert CORSMiddleware is StarletteCORSMiddleware
