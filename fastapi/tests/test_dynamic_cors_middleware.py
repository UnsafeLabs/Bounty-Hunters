from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware, DynamicCORSMiddleware
from fastapi.testclient import TestClient


def create_app(**middleware_kwargs):
    app = FastAPI()
    app.add_middleware(DynamicCORSMiddleware, **middleware_kwargs)

    @app.get("/")
    def read_root():
        return {"ok": True}

    return app


def preflight_headers(origin: str):
    return {
        "Origin": origin,
        "Access-Control-Request-Method": "GET",
    }


def test_dynamic_cors_sync_callback_allows_origin_and_sets_max_age():
    calls: list[str] = []

    def allow_origin(origin: str) -> bool:
        calls.append(origin)
        return origin == "https://allowed.example"

    app = create_app(
        allow_origin_func=allow_origin,
        allow_methods=["GET"],
        cors_max_age=123,
    )
    client = TestClient(app)

    response = client.options(
        "/",
        headers=preflight_headers("https://allowed.example"),
    )

    assert response.status_code == 200, response.text
    assert response.headers["access-control-allow-origin"] == "https://allowed.example"
    assert response.headers["access-control-max-age"] == "123"
    assert calls == ["https://allowed.example"]


def test_dynamic_cors_sync_callback_denies_origin_without_wildcard_leak():
    app = create_app(
        allow_origins=["*"],
        allow_origin_func=lambda origin: False,
        allow_methods=["GET"],
    )
    client = TestClient(app)

    preflight = client.options(
        "/",
        headers=preflight_headers("https://denied.example"),
    )
    simple = client.get("/", headers={"Origin": "https://denied.example"})

    assert preflight.status_code == 400, preflight.text
    assert preflight.text == "Disallowed CORS origin"
    assert "access-control-allow-origin" not in preflight.headers
    assert simple.status_code == 200, simple.text
    assert simple.json() == {"ok": True}
    assert "access-control-allow-origin" not in simple.headers


def test_dynamic_cors_async_callback_is_awaited():
    async def allow_origin(origin: str) -> bool:
        return origin.endswith(".example")

    app = create_app(
        allow_origin_func=allow_origin,
        allow_methods=["GET"],
    )
    client = TestClient(app)

    response = client.get("/", headers={"Origin": "https://async.example"})

    assert response.status_code == 200, response.text
    assert response.headers["access-control-allow-origin"] == "https://async.example"


def test_dynamic_cors_falls_back_to_static_origins_without_callback():
    app = create_app(
        allow_origins=["https://static.example"],
        allow_methods=["GET"],
    )
    client = TestClient(app)

    allowed = client.get("/", headers={"Origin": "https://static.example"})
    denied = client.get("/", headers={"Origin": "https://other.example"})

    assert allowed.status_code == 200, allowed.text
    assert allowed.headers["access-control-allow-origin"] == "https://static.example"
    assert denied.status_code == 200, denied.text
    assert "access-control-allow-origin" not in denied.headers


def test_existing_cors_middleware_export_is_unchanged():
    app = FastAPI()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["https://existing.example"],
        allow_methods=["GET"],
    )

    @app.get("/")
    def read_root():
        return {"ok": True}

    client = TestClient(app)
    response = client.get("/", headers={"Origin": "https://existing.example"})

    assert response.status_code == 200, response.text
    assert response.headers["access-control-allow-origin"] == "https://existing.example"
