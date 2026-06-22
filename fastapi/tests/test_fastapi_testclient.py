import pytest
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.testclient import FastAPITestClient


app = FastAPI()


@app.get("/me")
def get_me():
    return {"user": "test"}


@app.get("/protected")
def protected(request):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        from fastapi.responses import JSONResponse
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    return {"token": auth.split(" ", 1)[1]}


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    data = await websocket.receive_text()
    await websocket.send_text(f"echo: {data}")
    await websocket.close()


class TestFastAPITestClient:
    def test_authenticate_sets_bearer(self):
        client = FastAPITestClient(app)
        client.authenticate("test-token-123")
        resp = client.get("/protected")
        assert resp.status_code == 200
        assert resp.json()["token"] == "test-token-123"

    def test_authenticate_basic(self):
        client = FastAPITestClient(app)
        client.authenticate_basic("admin", "secret")
        resp = client.get("/protected")
        assert resp.status_code == 200

    def test_reset_auth(self):
        client = FastAPITestClient(app)
        client.authenticate("token1")
        client.reset_auth()
        resp = client.get("/protected")
        assert resp.status_code == 401

    def test_assert_status_pass(self):
        client = FastAPITestClient(app)
        client.assert_status("GET", "/me", 200)

    def test_assert_status_fail_message(self):
        client = FastAPITestClient(app)
        import traceback
        try:
            client.assert_status("GET", "/me", 404)
        except AssertionError as e:
            msg = str(e)
            assert "404" in msg
            assert "200" in msg

    def test_authenticate_replaces_token(self):
        client = FastAPITestClient(app)
        client.authenticate("first-token")
        client.authenticate("second-token")
        resp = client.get("/protected")
        assert resp.json()["token"] == "second-token"

    def test_basic_get(self):
        client = FastAPITestClient(app)
        resp = client.get("/me")
        assert resp.status_code == 200
        assert resp.json()["user"] == "test"
