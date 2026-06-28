from base64 import b64encode

import pytest
from fastapi import FastAPI, Request, Response, WebSocket
from fastapi.testclient import FastAPITestClient, TestClient
from starlette.testclient import TestClient as StarletteTestClient

app = FastAPI()


@app.get("/auth")
def read_auth(request: Request):
    return {"authorization": request.headers.get("authorization")}


@app.get("/status/{status_code}")
def status_response(status_code: int):
    return Response(status_code=status_code)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    await websocket.send_json(
        {
            "authorization": websocket.headers.get("authorization"),
            "subprotocols": websocket.headers.get("sec-websocket-protocol"),
            "x-client": websocket.headers.get("x-client"),
        }
    )
    await websocket.close()


def test_existing_test_client_import_is_unchanged():
    assert TestClient is StarletteTestClient
    client = TestClient(app)
    response = client.get("/auth")
    assert response.status_code == 200, response.text


def test_authenticate_sets_and_replaces_bearer_token():
    client = FastAPITestClient(app)

    client.authenticate("first-token")
    response = client.get("/auth")
    assert response.json() == {"authorization": "Bearer first-token"}

    client.authenticate("second-token")
    response = client.get("/auth")
    assert response.json() == {"authorization": "Bearer second-token"}


def test_authenticate_basic_sets_encoded_credentials():
    client = FastAPITestClient(app)

    client.authenticate_basic("alice", "wonderland")

    expected = f"Basic {b64encode(b'alice:wonderland').decode('ascii')}"
    response = client.get("/auth")
    assert response.json() == {"authorization": expected}


def test_reset_auth_clears_authentication_state():
    client = FastAPITestClient(app)

    client.authenticate("secret-token")
    client.reset_auth()

    response = client.get("/auth")
    assert response.json() == {"authorization": None}


def test_ws_connect_supports_custom_headers_subprotocols_and_auth():
    client = FastAPITestClient(app)
    client.authenticate("websocket-token")

    with client.ws_connect(
        "/ws",
        headers={"x-client": "custom"},
        subprotocols=["chat", "updates"],
    ) as websocket:
        data = websocket.receive_json()

    assert data == {
        "authorization": "Bearer websocket-token",
        "subprotocols": "chat, updates",
        "x-client": "custom",
    }


def test_ws_connect_custom_authorization_overrides_client_auth():
    client = FastAPITestClient(app)
    client.authenticate("client-token")

    with client.ws_connect(
        "/ws",
        headers={"authorization": "Bearer explicit-token"},
    ) as websocket:
        data = websocket.receive_json()

    assert data["authorization"] == "Bearer explicit-token"


def test_assert_status_returns_response():
    client = FastAPITestClient(app)

    response = client.assert_status("GET", "/status/202", 202)

    assert response.status_code == 202


def test_assert_status_raises_helpful_error():
    client = FastAPITestClient(app)

    with pytest.raises(AssertionError) as exc_info:
        client.assert_status("GET", "/status/404", 201)

    message = str(exc_info.value)
    assert "Expected status 201" in message
    assert "GET /status/404" in message
    assert "got 404" in message
