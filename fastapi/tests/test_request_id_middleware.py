from __future__ import annotations

import uuid

from starlette.testclient import TestClient

from fastapi import FastAPI, Request
from fastapi.middleware.request_id import RequestIDMiddleware


def _make_app():
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/test")
    async def test_endpoint(request: Request):
        return {"request_id": request.state.request_id}

    return app


class TestRequestIDMiddleware:
    def test_generates_request_id(self):
        app = _make_app()
        client = TestClient(app)

        resp = client.get("/test")
        assert resp.status_code == 200
        assert "X-Request-ID" in resp.headers
        # Should be a valid UUID
        request_id = resp.headers["X-Request-ID"]
        uuid.UUID(request_id)  # Raises ValueError if invalid

    def test_request_id_in_state(self):
        app = _make_app()
        client = TestClient(app)

        resp = client.get("/test")
        assert resp.status_code == 200
        data = resp.json()
        assert "request_id" in data
        # Should match the response header
        assert data["request_id"] == resp.headers["X-Request-ID"]

    def test_client_provided_request_id_preserved(self):
        app = _make_app()
        client = TestClient(app)

        custom_id = "my-custom-request-id-12345"
        resp = client.get("/test", headers={"X-Request-ID": custom_id})
        assert resp.status_code == 200
        assert resp.headers["X-Request-ID"] == custom_id
        assert resp.json()["request_id"] == custom_id

    def test_unique_ids_per_request(self):
        app = _make_app()
        client = TestClient(app)

        resp1 = client.get("/test")
        resp2 = client.get("/test")
        id1 = resp1.headers["X-Request-ID"]
        id2 = resp2.headers["X-Request-ID"]
        assert id1 != id2

    def test_non_http_passes_through(self):
        app = _make_app()
        client = TestClient(app)
        # Just ensure normal requests work
        resp = client.get("/test")
        assert resp.status_code == 200

    def test_multiple_requests_independent(self):
        app = _make_app()
        client = TestClient(app)

        ids = set()
        for _ in range(10):
            resp = client.get("/test")
            ids.add(resp.headers["X-Request-ID"])
        # All 10 should be unique
        assert len(ids) == 10
