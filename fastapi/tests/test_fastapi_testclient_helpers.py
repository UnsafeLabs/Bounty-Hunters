import base64
from typing import Annotated

import pytest
from fastapi import FastAPI, Header, WebSocket
from fastapi.testclient import FastAPITestClient, TestClient
from starlette.testclient import TestClient as StarletteTestClient

app = FastAPI()


@app.get("/headers")
def read_headers(authorization: Annotated[str | None, Header()] = None):
    return {"authorization": authorization}


@app.get("/status/{status_code}", status_code=200)
def read_status(status_code: int):
    return {"status_code": status_code}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    subprotocols = websocket.scope.get("subprotocols", [])
    await websocket.accept(subprotocol=subprotocols[0] if subprotocols else None)
    await websocket.send_json(
        {
            "authorization": websocket.headers.get("authorization"),
            "x-client": websocket.headers.get("x-client"),
            "subprotocols": subprotocols,
        }
    )
    await websocket.close()


def test_existing_testclient_export_is_unchanged():
    assert TestClient is StarletteTestClient
    assert issubclass(FastAPITestClient, StarletteTestClient)


def test_authenticate_sets_and_replaces_bearer_token():
    client = FastAPITestClient(app)

    client.authenticate("first-token")
    response = client.get("/headers")
    assert response.json() == {"authorization": "Bearer first-token"}

    client.authenticate("second-token")
    response = client.get("/headers")
    assert response.json() == {"authorization": "Bearer second-token"}


def test_reset_auth_clears_authentication_state():
    client = FastAPITestClient(app)

    client.authenticate("token")
    client.reset_auth()

    response = client.get("/headers")
    assert response.json() == {"authorization": None}


def test_authenticate_basic_sets_encoded_credentials():
    client = FastAPITestClient(app)

    client.authenticate_basic("alice", "wonderland")

    encoded = base64.b64encode(b"alice:wonderland").decode("ascii")
    response = client.get("/headers")
    assert response.json() == {"authorization": f"Basic {encoded}"}


def test_ws_connect_merges_auth_custom_headers_and_subprotocols():
    client = FastAPITestClient(app)
    client.authenticate("socket-token")

    with client.ws_connect(
        "/ws", headers={"x-client": "desktop"}, subprotocols=["chat"]
    ) as websocket:
        assert websocket.accepted_subprotocol == "chat"
        assert websocket.receive_json() == {
            "authorization": "Bearer socket-token",
            "x-client": "desktop",
            "subprotocols": ["chat"],
        }


def test_assert_status_returns_response_on_match():
    client = FastAPITestClient(app)

    response = client.assert_status("GET", "/status/200", 200)

    assert response.json() == {"status_code": 200}


def test_assert_status_raises_helpful_error_on_mismatch():
    client = FastAPITestClient(app)

    with pytest.raises(
        AssertionError,
        match=r"Expected GET /status/200 to return 201, got 200",
    ):
        client.assert_status("GET", "/status/200", 201)
