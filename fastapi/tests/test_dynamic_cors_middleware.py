from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware, DynamicCORSMiddleware
from fastapi.testclient import TestClient
from starlette.middleware.cors import CORSMiddleware as StarletteCORSMiddleware


def build_app(**middleware_kwargs):
    app = FastAPI()
    app.add_middleware(DynamicCORSMiddleware, **middleware_kwargs)

    @app.get("/")
    def homepage():
        return {"message": "Hello World"}

    return app


def test_cors_middleware_export_unchanged():
    # The existing CORSMiddleware export must keep pointing to Starlette's class.
    assert CORSMiddleware is StarletteCORSMiddleware


def test_dynamic_allow():
    app = build_app(
        allow_origin_func=lambda origin: origin == "https://allowed.example"
    )
    client = TestClient(app)
    response = client.get("/", headers={"Origin": "https://allowed.example"})
    assert response.status_code == 200, response.text
    assert (
        response.headers["access-control-allow-origin"] == "https://allowed.example"
    )


def test_dynamic_deny():
    app = build_app(
        allow_origin_func=lambda origin: origin == "https://allowed.example"
    )
    client = TestClient(app)
    response = client.get("/", headers={"Origin": "https://denied.example"})
    assert response.status_code == 200, response.text
    assert "access-control-allow-origin" not in response.headers


def test_async_callback():
    async def allow_origin(origin: str) -> bool:
        return origin.endswith(".trusted.example")

    app = build_app(allow_origin_func=allow_origin)
    client = TestClient(app)

    allowed = client.get("/", headers={"Origin": "https://api.trusted.example"})
    assert allowed.status_code == 200, allowed.text
    assert (
        allowed.headers["access-control-allow-origin"]
        == "https://api.trusted.example"
    )

    denied = client.get("/", headers={"Origin": "https://evil.example"})
    assert denied.status_code == 200, denied.text
    assert "access-control-allow-origin" not in denied.headers


def test_fallback_to_static_list():
    # No callback provided -> behave like the static CORSMiddleware.
    app = build_app(allow_origins=["https://static.example"])
    client = TestClient(app)

    allowed = client.get("/", headers={"Origin": "https://static.example"})
    assert allowed.headers["access-control-allow-origin"] == "https://static.example"

    denied = client.get("/", headers={"Origin": "https://other.example"})
    assert "access-control-allow-origin" not in denied.headers


def test_cors_max_age_in_preflight():
    app = build_app(
        allow_origin_func=lambda origin: True,
        allow_methods=["GET"],
        cors_max_age=7200,
    )
    client = TestClient(app)
    response = client.options(
        "/",
        headers={
            "Origin": "https://any.example",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.status_code == 200, response.text
    assert response.headers["access-control-max-age"] == "7200"
    assert response.headers["access-control-allow-origin"] == "https://any.example"


def test_preflight_denied_origin():
    app = build_app(
        allow_origin_func=lambda origin: origin == "https://ok.example",
        allow_methods=["GET"],
    )
    client = TestClient(app)
    response = client.options(
        "/",
        headers={
            "Origin": "https://bad.example",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.status_code == 400, response.text
    assert "access-control-allow-origin" not in response.headers


def test_non_cors_request_untouched():
    app = build_app(allow_origin_func=lambda origin: True)
    client = TestClient(app)
    response = client.get("/")
    assert response.status_code == 200, response.text
    assert response.json() == {"message": "Hello World"}
    assert "access-control-allow-origin" not in response.headers
