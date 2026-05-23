from fastapi import FastAPI
from fastapi.middleware.request_id import RequestIDMiddleware
from fastapi.testclient import TestClient


def test_request_id_added_to_response():
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/")
    async def root():
        return {"msg": "ok"}

    client = TestClient(app)
    resp = client.get("/")
    assert resp.status_code == 200
    assert "x-request-id" in resp.headers
    assert len(resp.headers["x-request-id"]) == 12


def test_client_provided_request_id_preserved():
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/")
    async def root():
        return {"msg": "ok"}

    client = TestClient(app)
    resp = client.get("/", headers={"X-Request-ID": "my-custom-id-123"})
    assert resp.status_code == 200
    assert resp.headers.get("x-request-id") == "my-custom-id-123"


def test_different_requests_get_different_ids():
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/")
    async def root():
        return {"msg": "ok"}

    client = TestClient(app)
    resp1 = client.get("/")
    resp2 = client.get("/")
    assert resp1.headers["x-request-id"] != resp2.headers["x-request-id"]
