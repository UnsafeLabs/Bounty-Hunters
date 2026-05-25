from base64 import b64encode

import pytest
from fastapi import FastAPI, Header, WebSocket
from fastapi.testclient import FastAPITestClient, TestClient
from starlette.testclient import TestClient as StarletteTestClient


app = FastAPI()


@app.get("/auth")
def read_auth(authorization: str | None = Header(default=None)):
    return {"authorization": authorization}


@app.get("/ok")
def read_ok():
    return {"ok": True}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    await websocket.send_json(
        {
            "authorization": websocket.headers.get("authorization"),
            "x-client": websocket.headers.get("x-client"),
            "subprotocols": websocket.headers.get("sec-websocket-protocol"),
        }
    )
    await websocket.close()


def test_existing_testclient_export_is_unchanged():
    assert TestClient is StarletteTestClient


def test_authenticate_sets_bearer_token_for_following_requests():
    client = FastAPITestClient(app)
    assert client.authenticate("first-token") is client

    response = client.get("/auth")
    assert response.json() == {"authorization": "Bearer first-token"}

    second_response = client.get("/auth")
    assert second_response.json() == {"authorization": "Bearer first-token"}


def test_authenticate_replaces_previous_token():
    client = FastAPITestClient(app)
    client.authenticate("first-token")
    client.authenticate("second-token")

    response = client.get("/auth")
    assert response.json() == {"authorization": "Bearer second-token"}


def test_authenticate_basic_sets_encoded_basic_header():
    client = FastAPITestClient(app)
    assert client.authenticate_basic("alice", "wonderland") is client

    expected = b64encode(b"alice:wonderland").decode("ascii")
    response = client.get("/auth")
    assert response.json() == {"authorization": f"Basic {expected}"}


def test_reset_auth_clears_authentication_state():
    client = FastAPITestClient(app)
    assert client.authenticate("first-token").reset_auth() is client

    response = client.get("/auth")
    assert response.json() == {"authorization": None}


def test_ws_connect_passes_auth_custom_headers_and_subprotocols():
    client = FastAPITestClient(app)
    client.authenticate("socket-token")

    with client.ws_connect(
        "/ws", headers={"x-client": "mobile"}, subprotocols=["chat", "json"]
    ) as websocket:
        assert websocket.receive_json() == {
            "authorization": "Bearer socket-token",
            "x-client": "mobile",
            "subprotocols": "chat, json",
        }


def test_assert_status_returns_response_when_status_matches():
    client = FastAPITestClient(app)

    response = client.assert_status("GET", "/ok", 200)
    assert response.json() == {"ok": True}


def test_assert_status_raises_helpful_message_when_status_differs():
    client = FastAPITestClient(app)

    with pytest.raises(AssertionError) as exc_info:
        client.assert_status("GET", "/ok", 201)

    assert "Expected 201 for GET /ok, got 200" in str(exc_info.value)
    assert '{"ok":true}' in str(exc_info.value)
