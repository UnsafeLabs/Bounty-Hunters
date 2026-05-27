from uuid import UUID

from fastapi import FastAPI
from fastapi.middleware import RequestIDMiddleware
from fastapi.testclient import TestClient


def test_request_id_middleware_adds_header():
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/")
    def root():
        return {"message": "Hello World"}

    client = TestClient(app)
    response = client.get("/")

    assert response.status_code == 200
    assert "X-Request-ID" in response.headers
    # Verify it's a valid UUID
    request_id = response.headers["X-Request-ID"]
    UUID(request_id)  # Will raise if invalid


def test_request_id_middleware_preserves_client_header():
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/")
    def root():
        return {"message": "Hello World"}

    client = TestClient(app)
    response = client.get("/", headers={"X-Request-ID": "my-custom-id"})

    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == "my-custom-id"


def test_request_id_middleware_generates_uuid():
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/")
    def root():
        return {"message": "Hello World"}

    client = TestClient(app)
    response = client.get("/")

    assert response.status_code == 200
    request_id = response.headers["X-Request-ID"]
    # Verify it's a UUID v4
    uuid_obj = UUID(request_id)
    assert uuid_obj.version == 4


def test_request_id_middleware_unique_per_request():
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/")
    def root():
        return {"message": "Hello World"}

    client = TestClient(app)
    response1 = client.get("/")
    response2 = client.get("/")

    id1 = response1.headers["X-Request-ID"]
    id2 = response2.headers["X-Request-ID"]
    assert id1 != id2
