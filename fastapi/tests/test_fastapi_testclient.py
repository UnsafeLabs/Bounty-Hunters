import base64

import pytest

from fastapi import FastAPI, Header, WebSocket
from fastapi.testclient import FastAPITestClient, TestClient


app = FastAPI()


@app.get("/headers")
def headers(authorization: str | None = Header(default=None)):
    return {"authorization": authorization}


@app.get("/ok")
def ok():
    return {"ok": True}


@app.websocket("/ws")
async def websocket(websocket: WebSocket):
    await websocket.accept(subprotocol="chat")
    await websocket.send_json(
        {
            "x-test": websocket.headers.get("x-test", "missing"),
            "authorization": websocket.headers.get("authorization"),
        }
    )
    await websocket.close()


def test_existing_testclient_import_still_works():
    assert TestClient(app).get("/ok").status_code == 200


def test_authenticate_sets_and_replaces_bearer_header():
    client = FastAPITestClient(app)

    client.authenticate("one")
    assert client.headers["Authorization"] == "Bearer one"
    assert client.get("/headers").json() == {"authorization": "Bearer one"}

    client.authenticate("two")
    assert client.headers["Authorization"] == "Bearer two"
    assert client.get("/headers").json() == {"authorization": "Bearer two"}


def test_authenticate_basic_sets_encoded_header():
    client = FastAPITestClient(app)
    client.authenticate_basic("user", "secret")

    encoded = base64.b64encode(b"user:secret").decode()
    assert client.headers["Authorization"] == f"Basic {encoded}"


def test_reset_auth_clears_authentication_state():
    client = FastAPITestClient(app)

    client.authenticate("secret").reset_auth()

    assert "Authorization" not in client.headers


def test_assert_status_returns_response_and_raises_helpfully():
    client = FastAPITestClient(app)

    response = client.assert_status("GET", "/ok", 200)

    assert response.json() == {"ok": True}

    with pytest.raises(AssertionError, match="Expected status 404"):
        client.assert_status("GET", "/ok", 404)


def test_ws_connect_supports_headers_and_subprotocols():
    client = FastAPITestClient(app)

    with client.ws_connect(
        "/ws",
        headers={"x-test": "hello"},
        subprotocols=["chat"],
    ) as websocket:
        assert websocket.receive_json() == {"x-test": "hello", "authorization": None}


def test_ws_connect_inherits_authentication_header():
    client = FastAPITestClient(app).authenticate("socket-token")

    with client.ws_connect("/ws", subprotocols=["chat"]) as websocket:
        assert websocket.receive_json() == {
            "x-test": "missing",
            "authorization": "Bearer socket-token",
        }
