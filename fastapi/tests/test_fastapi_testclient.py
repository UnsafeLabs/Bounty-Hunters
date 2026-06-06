import pytest
from fastapi import FastAPI, WebSocket
from fastapi.testclient import FastAPITestClient, TestClient

app = FastAPI()


@app.get("/headers")
def read_headers():
    return {}


@app.get("/auth")
def read_auth_header():
    return {}


@app.get("/ok")
def read_ok():
    return {"ok": True}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept(subprotocol="chat")
    await websocket.send_json(
        {
            "authorization": websocket.headers.get("authorization"),
            "x-client": websocket.headers.get("x-client"),
            "subprotocols": websocket.scope["subprotocols"],
        }
    )
    await websocket.close()


def test_existing_testclient_import_still_works():
    client = TestClient(app)

    response = client.get("/ok")

    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_fastapi_testclient_authenticate_sets_bearer_header():
    client = FastAPITestClient(app)

    client.authenticate("first-token")
    response = client.get("/auth")

    assert response.request.headers["authorization"] == "Bearer first-token"


def test_fastapi_testclient_authenticate_replaces_previous_token():
    client = FastAPITestClient(app)

    client.authenticate("first-token")
    client.authenticate("second-token")
    response = client.get("/auth")

    assert response.request.headers["authorization"] == "Bearer second-token"


def test_fastapi_testclient_authenticate_basic_sets_basic_header():
    client = FastAPITestClient(app)

    client.authenticate_basic("alice", "secret")
    response = client.get("/auth")

    assert response.request.headers["authorization"] == "Basic YWxpY2U6c2VjcmV0"


def test_fastapi_testclient_reset_auth_clears_header():
    client = FastAPITestClient(app)

    client.authenticate("secret")
    client.reset_auth()
    response = client.get("/auth")

    assert "authorization" not in response.request.headers


def test_fastapi_testclient_ws_connect_merges_headers_and_subprotocols():
    client = FastAPITestClient(app)

    client.authenticate("socket-token")
    with client.ws_connect(
        "/ws",
        headers={"x-client": "codex"},
        subprotocols=["chat", "superchat"],
    ) as websocket:
        data = websocket.receive_json()

    assert data == {
        "authorization": "Bearer socket-token",
        "x-client": "codex",
        "subprotocols": ["chat", "superchat"],
    }
    assert websocket.accepted_subprotocol == "chat"


def test_fastapi_testclient_assert_status_returns_response():
    client = FastAPITestClient(app)

    response = client.assert_status("GET", "/ok", 200)

    assert response.json() == {"ok": True}


def test_fastapi_testclient_assert_status_has_helpful_message():
    client = FastAPITestClient(app)

    with pytest.raises(AssertionError) as exc_info:
        client.assert_status("GET", "/missing", 200)

    assert "Expected status code 200, got 404" in str(exc_info.value)
