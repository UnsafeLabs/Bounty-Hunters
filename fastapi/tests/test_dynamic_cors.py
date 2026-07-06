import pytest
from fastapi import FastAPI
from fastapi.middleware.cors import DynamicCORSMiddleware
from fastapi.testclient import TestClient

def test_dynamic_cors_allow_sync():
    app = FastAPI()

    def allow_origin_func(origin: str) -> bool:
        return origin.endswith("example.com")

    app.add_middleware(
        DynamicCORSMiddleware,
        allow_origin_func=allow_origin_func,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/")
    def root():
        return {"message": "Hello World"}

    client = TestClient(app)

    response = client.get("/", headers={"Origin": "https://foo.example.com"})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://foo.example.com"

    response = client.options("/", headers={"Origin": "https://foo.example.com", "Access-Control-Request-Method": "GET"})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://foo.example.com"


def test_dynamic_cors_deny_sync():
    app = FastAPI()

    def allow_origin_func(origin: str) -> bool:
        return origin.endswith("example.com")

    app.add_middleware(
        DynamicCORSMiddleware,
        allow_origin_func=allow_origin_func,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/")
    def root():
        return {"message": "Hello World"}

    client = TestClient(app)

    # Simple request does not add the header if disallowed
    response = client.get("/", headers={"Origin": "https://foo.badsite.com"})
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers

    # Preflight fails
    response = client.options("/", headers={"Origin": "https://foo.badsite.com", "Access-Control-Request-Method": "GET"})
    assert response.status_code == 400
    assert response.text == "Disallowed CORS origin"


def test_dynamic_cors_async():
    app = FastAPI()

    async def allow_origin_func(origin: str) -> bool:
        return origin == "https://async.com"

    app.add_middleware(
        DynamicCORSMiddleware,
        allow_origin_func=allow_origin_func,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/")
    def root():
        return {"message": "Hello World"}

    client = TestClient(app)

    response = client.get("/", headers={"Origin": "https://async.com"})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://async.com"

    response = client.options("/", headers={"Origin": "https://async.com", "Access-Control-Request-Method": "GET"})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://async.com"


def test_dynamic_cors_fallback_to_static():
    app = FastAPI()

    # No allow_origin_func, fallback to static allow_origins
    app.add_middleware(
        DynamicCORSMiddleware,
        allow_origins=["https://static.com"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/")
    def root():
        return {"message": "Hello World"}

    client = TestClient(app)

    response = client.get("/", headers={"Origin": "https://static.com"})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://static.com"

    response = client.options("/", headers={"Origin": "https://static.com", "Access-Control-Request-Method": "GET"})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://static.com"

    response = client.options("/", headers={"Origin": "https://bad.com", "Access-Control-Request-Method": "GET"})
    assert response.status_code == 400
