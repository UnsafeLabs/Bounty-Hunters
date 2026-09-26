import pytest
from fastapi import FastAPI
from fastapi.middleware.cors import DynamicCORSMiddleware
from fastapi.testclient import TestClient


def build_app(**middleware_kwargs) -> FastAPI:
    app = FastAPI()
    app.add_middleware(DynamicCORSMiddleware, **middleware_kwargs)

    @app.get("/")
    def homepage():
        return {"hello": "world"}

    return app


def test_dynamic_allow_origin():
    def allow(origin: str) -> bool:
        return origin == "https://allowed.example"

    client = TestClient(build_app(allow_origin_func=allow))

    response = client.get("/", headers={"Origin": "https://allowed.example"})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://allowed.example"


def test_dynamic_deny_origin():
    def allow(origin: str) -> bool:
        return origin == "https://allowed.example"

    client = TestClient(build_app(allow_origin_func=allow))

    response = client.get("/", headers={"Origin": "https://evil.example"})
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


def test_async_callback_allow():
    async def allow(origin: str) -> bool:
        return origin.endswith(".trusted.example")

    client = TestClient(build_app(allow_origin_func=allow))

    response = client.get("/", headers={"Origin": "https://api.trusted.example"})
    assert response.status_code == 200
    assert (
        response.headers["access-control-allow-origin"] == "https://api.trusted.example"
    )


def test_async_callback_deny():
    async def allow(origin: str) -> bool:
        return origin.endswith(".trusted.example")

    client = TestClient(build_app(allow_origin_func=allow))

    response = client.get("/", headers={"Origin": "https://other.example"})
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


def test_static_fallback_when_callback_absent():
    client = TestClient(build_app(allow_origins=["https://listed.example"]))

    allowed = client.get("/", headers={"Origin": "https://listed.example"})
    assert allowed.headers["access-control-allow-origin"] == "https://listed.example"

    denied = client.get("/", headers={"Origin": "https://unlisted.example"})
    assert "access-control-allow-origin" not in denied.headers


def test_cors_max_age_in_preflight():
    def allow(origin: str) -> bool:
        return True

    client = TestClient(
        build_app(
            allow_origin_func=allow,
            allow_methods=["GET", "POST"],
            cors_max_age=1234,
        )
    )

    response = client.options(
        "/",
        headers={
            "Origin": "https://allowed.example",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-max-age"] == "1234"
    assert response.headers["access-control-allow-origin"] == "https://allowed.example"


def test_preflight_denied_origin_has_no_allow_origin():
    def allow(origin: str) -> bool:
        return origin == "https://allowed.example"

    client = TestClient(
        build_app(allow_origin_func=allow, allow_methods=["GET", "POST"])
    )

    response = client.options(
        "/",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_credentials_echo_specific_origin():
    def allow(origin: str) -> bool:
        return True

    client = TestClient(build_app(allow_origin_func=allow, allow_credentials=True))

    response = client.get("/", headers={"Origin": "https://any.example"})
    assert response.headers["access-control-allow-origin"] == "https://any.example"
    assert response.headers["access-control-allow-credentials"] == "true"


def test_request_without_origin_passes_through():
    def allow(origin: str) -> bool:  # pragma: no cover - should not be called
        raise AssertionError("callback should not run without an Origin header")

    client = TestClient(build_app(allow_origin_func=allow))

    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"hello": "world"}


def test_stacked_instances_use_own_decision():
    # Two DynamicCORSMiddleware layers must not share decisions. The last-added
    # middleware is outermost, so its verdict is what the client sees.
    app = FastAPI()
    app.add_middleware(
        DynamicCORSMiddleware, allow_origin_func=lambda o: False
    )  # inner: deny
    app.add_middleware(
        DynamicCORSMiddleware, allow_origin_func=lambda o: True
    )  # outer: allow

    @app.get("/")
    def homepage():
        return {"hello": "world"}

    response = TestClient(app).get("/", headers={"Origin": "https://x.example"})
    assert response.status_code == 200
    # Outer layer allows; a leak from the inner "deny" would drop this header.
    assert response.headers["access-control-allow-origin"] == "https://x.example"


def test_wildcard_with_callback_is_rejected():
    async def app(scope, receive, send):  # pragma: no cover - never invoked
        raise AssertionError

    with pytest.raises(ValueError, match="wildcard"):
        DynamicCORSMiddleware(
            app, allow_origins=["*"], allow_origin_func=lambda o: True
        )


def test_denied_origin_sets_vary_origin():
    client = TestClient(
        build_app(allow_origin_func=lambda o: o == "https://good.example")
    )
    response = client.get("/", headers={"Origin": "https://evil.example"})
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers
    # Denied responses must still vary on Origin so a cache does not serve this
    # response to an allowed origin.
    assert response.headers["vary"] == "Origin"


def test_allowed_origin_does_not_duplicate_vary():
    client = TestClient(build_app(allow_origin_func=lambda o: True))
    response = client.get("/", headers={"Origin": "https://good.example"})
    assert response.headers["access-control-allow-origin"] == "https://good.example"
    vary_values = [v.strip() for v in response.headers["vary"].split(",")]
    assert vary_values.count("Origin") == 1
