import pytest
from fastapi import FastAPI, Header, WebSocket
from fastapi.testclient import FastAPITestClient


app = FastAPI()


@app.get("/protected")
def protected_route(authorization: str = Header(None)):
    return {"auth": authorization}


@app.get("/public")
def public_route():
    return {"status": "ok"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    data = await websocket.receive_text()
    await websocket.send_text(f"echo: {data}")
    await websocket.close()


def test_authenticate_sets_bearer_token():
    client = FastAPITestClient(app)
    client.authenticate("test-token-123")
    response = client.get("/protected")
    assert response.status_code == 200
    assert response.json()["auth"] == "Bearer test-token-123"


def test_authenticate_basic_sets_basic_auth():
    client = FastAPITestClient(app)
    client.authenticate_basic("user", "pass")
    response = client.get("/protected")
    assert response.status_code == 200
    assert response.json()["auth"].startswith("Basic ")


def test_reset_auth_clears_token():
    client = FastAPITestClient(app)
    client.authenticate("test-token")
    client.reset_auth()
    response = client.get("/protected")
    assert response.status_code == 200
    assert response.json()["auth"] is None


def test_authenticate_replaces_previous_token():
    client = FastAPITestClient(app)
    client.authenticate("first-token")
    client.authenticate("second-token")
    response = client.get("/protected")
    assert response.json()["auth"] == "Bearer second-token"


def test_authenticate_basic_replaces_bearer():
    client = FastAPITestClient(app)
    client.authenticate("bearer-token")
    client.authenticate_basic("user", "pass")
    response = client.get("/protected")
    assert response.json()["auth"].startswith("Basic ")


def test_assert_status_passes():
    client = FastAPITestClient(app)
    response = client.assert_status("GET", "/public", 200)
    assert response.json() == {"status": "ok"}


def test_assert_status_fails():
    client = FastAPITestClient(app)
    with pytest.raises(AssertionError, match="Expected status 404"):
        client.assert_status("GET", "/public", 404)


def test_request_without_auth():
    client = FastAPITestClient(app)
    response = client.get("/protected")
    assert response.status_code == 200
    assert response.json()["auth"] is None


def test_ws_connect():
    client = FastAPITestClient(app)
    with client.ws_connect("/ws") as ws:
        ws.send_text("hello")
        data = ws.receive_text()
        assert data == "echo: hello"


def test_ws_connect_with_headers():
    client = FastAPITestClient(app)
    with client.ws_connect("/ws", headers={"X-Custom": "value"}) as ws:
        ws.send_text("test")
        data = ws.receive_text()
        assert data == "echo: test"
