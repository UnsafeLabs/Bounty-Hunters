import base64

import pytest
from fastapi import FastAPI, Header, WebSocket
from fastapi.testclient import FastAPITestClient, TestClient
from starlette.testclient import TestClient as StarletteTestClient


def auth_app() -> FastAPI:
    app = FastAPI()

    @app.get("/headers")
    def read_headers(authorization: str | None = Header(default=None)):
        return {"authorization": authorization}

    return app


def test_existing_testclient_export_is_unchanged():
    assert TestClient is StarletteTestClient


def test_authenticate_sets_and_replaces_bearer_token():
    client = FastAPITestClient(auth_app())

    client.authenticate("first-token")
    assert client.get("/headers").json() == {"authorization": "Bearer first-token"}

    client.authenticate("second-token")
    assert client.get("/headers").json() == {"authorization": "Bearer second-token"}


def test_authenticate_basic_sets_encoded_credentials():
    client = FastAPITestClient(auth_app())

    client.authenticate_basic("alice", "secret")

    encoded = base64.b64encode(b"alice:secret").decode("ascii")
    assert client.get("/headers").json() == {"authorization": f"Basic {encoded}"}


def test_reset_auth_clears_authentication_state():
    client = FastAPITestClient(auth_app())

    client.authenticate("token").reset_auth()

    assert client.get("/headers").json() == {"authorization": None}


def test_ws_connect_merges_auth_headers_custom_headers_and_subprotocols():
    app = FastAPI()

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        requested_subprotocols = websocket.headers.get("sec-websocket-protocol")
        await websocket.accept(subprotocol="chat")
        await websocket.send_json(
            {
                "authorization": websocket.headers.get("authorization"),
                "trace": websocket.headers.get("x-trace"),
                "subprotocols": requested_subprotocols,
            }
        )
        await websocket.close()

    client = FastAPITestClient(app)
    client.authenticate("socket-token")

    with client.ws_connect(
        "/ws", headers={"X-Trace": "abc"}, subprotocols=["chat", "json"]
    ) as websocket:
        assert websocket.receive_json() == {
            "authorization": "Bearer socket-token",
            "trace": "abc",
            "subprotocols": "chat, json",
        }


def test_assert_status_returns_response_on_match():
    app = FastAPI()

    @app.get("/ok")
    def read_ok():
        return {"ok": True}

    client = FastAPITestClient(app)

    response = client.assert_status("GET", "/ok", 200)

    assert response.json() == {"ok": True}


def test_assert_status_raises_helpful_error_on_mismatch():
    client = FastAPITestClient(FastAPI())

    with pytest.raises(AssertionError) as exc_info:
        client.assert_status("GET", "/missing", 200)

    message = str(exc_info.value)
    assert "Expected status 200 for GET /missing" in message
    assert "received 404" in message
