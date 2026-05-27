"""Tests for the FastAPITestClient helper class."""

from starlette.requests import Request

import pytest
from fastapi import FastAPI, WebSocket
from fastapi.responses import JSONResponse
from fastapi.testclient import FastAPITestClient
from fastapi.testclient import TestClient  # noqa: ensure the original import is preserved


def test_original_testclient_still_works():
    """Verify that the original TestClient import is unchanged."""
    from fastapi.testclient import TestClient as OriginalTC  # noqa


class TestAuthenticate:
    """Tests for the ``authenticate`` helper."""

    def test_bearer_token_added(self):
        app = FastAPI()

        @app.get("/me")
        async def me(request: Request):
            auth = request.headers.get("authorization", "")
            return {"auth": auth}

        client = FastAPITestClient(app)
        client.authenticate("my-secret-token")
        resp = client.get("/me")
        assert resp.status_code == 200
        assert resp.json()["auth"] == "Bearer my-secret-token"

    def test_bearer_applies_to_all_subsequent_requests(self):
        app = FastAPI()

        @app.get("/a")
        async def a(request: Request):
            return {"auth": request.headers.get("authorization", "")}

        @app.get("/b")
        async def b(request: Request):
            return {"auth": request.headers.get("authorization", "")}

        client = FastAPITestClient(app)
        client.authenticate("tok")
        r1 = client.get("/a")
        r2 = client.get("/b")
        assert r1.json()["auth"] == "Bearer tok"
        assert r2.json()["auth"] == "Bearer tok"

    def test_per_request_header_overrides_auth(self):
        app = FastAPI()

        @app.get("/me")
        async def me(request: Request):
            return {"auth": request.headers.get("authorization", "")}

        client = FastAPITestClient(app)
        client.authenticate("default-token")
        resp = client.get("/me", headers={"Authorization": "Bearer override"})
        assert resp.json()["auth"] == "Bearer override"


class TestAuthenticateBasic:
    """Tests for the ``authenticate_basic`` helper."""

    def test_basic_auth_added(self):
        app = FastAPI()

        @app.get("/basic")
        async def basic(request: Request):
            return {"auth": request.headers.get("authorization", "")}

        client = FastAPITestClient(app)
        client.authenticate_basic("alice", "secret")
        resp = client.get("/basic")
        assert resp.status_code == 200
        # base64("alice:secret") = YWxpY2U6c2VjcmV0
        assert resp.json()["auth"] == "Basic YWxpY2U6c2VjcmV0"

    def test_basic_with_empty_password(self):
        app = FastAPI()

        @app.get("/basic")
        async def basic(request: Request):
            return {"auth": request.headers.get("authorization", "")}

        client = FastAPITestClient(app)
        client.authenticate_basic("bob", "")
        resp = client.get("/basic")
        assert resp.status_code == 200
        # base64("bob:") = Ym9iOg==
        assert resp.json()["auth"] == "Basic Ym9iOg=="


class TestResetAuth:
    """Tests for the ``reset_auth`` helper."""

    def test_reset_clears_auth(self):
        app = FastAPI()

        @app.get("/")
        async def root(request: Request):
            return {"auth": request.headers.get("authorization", "none")}

        client = FastAPITestClient(app)
        client.authenticate("tok")
        assert client.get("/").json()["auth"] == "Bearer tok"
        client.reset_auth()
        assert client.get("/").json()["auth"] == "none"

    def test_reset_then_reauthenticate(self):
        app = FastAPI()

        @app.get("/")
        async def root(request: Request):
            return {"auth": request.headers.get("authorization", "none")}

        client = FastAPITestClient(app)
        client.authenticate("first")
        client.reset_auth()
        client.authenticate("second")
        assert client.get("/").json()["auth"] == "Bearer second"


class TestWsConnect:
    """Tests for the ``ws_connect`` helper."""

    def test_ws_connect_context_manager(self):
        app = FastAPI()

        @app.websocket("/ws")
        async def ws_endpoint(websocket: WebSocket):
            await websocket.accept()
            data = await websocket.receive_text()
            await websocket.send_text(f"Echo: {data}")
            await websocket.close()

        client = FastAPITestClient(app)
        with client.ws_connect("/ws") as ws:
            ws.send_text("hello")
            assert ws.receive_text() == "Echo: hello"

    def test_ws_connect_with_custom_headers(self):
        app = FastAPI()

        @app.websocket("/ws")
        async def ws_endpoint(websocket: WebSocket):
            await websocket.accept()
            custom = websocket.headers.get("x-custom", "")
            await websocket.send_text(custom)
            await websocket.close()

        client = FastAPITestClient(app)
        with client.ws_connect("/ws", headers={"X-Custom": "my-value"}) as ws:
            assert ws.receive_text() == "my-value"

    def test_ws_connect_with_auth_headers(self):
        app = FastAPI()

        @app.websocket("/ws")
        async def ws_endpoint(websocket: WebSocket):
            await websocket.accept()
            auth = websocket.headers.get("authorization", "")
            await websocket.send_text(auth)
            await websocket.close()

        client = FastAPITestClient(app)
        client.authenticate("ws-token")
        with client.ws_connect("/ws") as ws:
            assert ws.receive_text() == "Bearer ws-token"


class TestAssertStatus:
    """Tests for the ``assert_status`` helper."""

    def test_assert_status_ok(self):
        app = FastAPI()

        @app.get("/ok")
        async def ok():
            return {"status": "ok"}

        client = FastAPITestClient(app)
        resp = client.assert_status(200, "GET", "/ok")
        assert resp.json() == {"status": "ok"}

    def test_assert_status_created(self):
        app = FastAPI()

        @app.post("/items")
        async def create():
            return JSONResponse({"id": 1}, status_code=201)

        client = FastAPITestClient(app)
        resp = client.assert_status(201, "POST", "/items")
        assert resp.json()["id"] == 1

    def test_assert_status_raises_on_mismatch(self):
        app = FastAPI()

        @app.get("/not-found")
        async def not_found():
            return JSONResponse({"error": "not found"}, status_code=404)

        client = FastAPITestClient(app)
        with pytest.raises(AssertionError, match="Expected status 200, got 404"):
            client.assert_status(200, "GET", "/not-found")

    def test_assert_status_with_auth(self):
        app = FastAPI()

        @app.get("/protected")
        async def protected(request: Request):
            if request.headers.get("authorization") == "Bearer tok":
                return {"msg": "ok"}
            return JSONResponse({"msg": "unauthorized"}, status_code=401)

        client = FastAPITestClient(app)
        client.authenticate("tok")
        resp = client.assert_status(200, "GET", "/protected")
        assert resp.json()["msg"] == "ok"