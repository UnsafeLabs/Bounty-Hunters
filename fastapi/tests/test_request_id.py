import uuid

from fastapi.middleware.request_id import RequestIDMiddleware
from fastapi.testclient import TestClient


def test_request_id_middleware():
    from fastapi import FastAPI

    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/test")
    async def read_root(request):
        return {"request_id": request.state.request_id}

    client = TestClient(app)
    response = client.get("/test")

    assert response.status_code == 200
    assert "X-Request-ID" in response.headers
    request_id = response.headers["X-Request-ID"]
    # Verify it's a valid UUID
    uuid.UUID(request_id)
    # Verify state is consistent
    assert response.json()["request_id"] == request_id


def test_multiple_requests_have_different_ids():
    from fastapi import FastAPI

    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/test")
    async def read_root(request):
        return {"request_id": request.state.request_id}

    client = TestClient(app)
    id1 = client.get("/test").headers["X-Request-ID"]
    id2 = client.get("/test").headers["X-Request-ID"]
    assert id1 != id2
