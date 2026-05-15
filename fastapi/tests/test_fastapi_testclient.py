from base64 import b64encode

import pytest
from fastapi import FastAPI, Header, WebSocket
from fastapi.testclient import FastAPITestClient, TestClient


def test_existing_testclient_import_is_unchanged():
    app = FastAPI()

    @app.get("/")
    def read_root():
        return {"ok": True}

    client = TestClient(app)

    assert not isinstance(client, FastAPITestClient)
    assert client.get("/").json() == {"ok": True}


def test_authenticate_sets_replaces_and_resets_bearer_header():
    app = FastAPI()

    @app.get("/auth")
    def read_auth(authorization: str | None = Header(default=None)):
        return {"authorization": authorization}

    client = FastAPITestClient(app)

    assert client.get("/auth").json() == {"authorization": None}

    client.authenticate("first-token")
    assert client.get("/auth").json() == {"authorization": "Bearer first-token"}

    client.authenticate("second-token")
    assert client.get("/auth").json() == {"authorization": "Bearer second-token"}

    client.reset_auth()
    assert client.get("/auth").json() == {"authorization": None}


def test_authenticate_basic_sets_encoded_basic_authorization_header():
    app = FastAPI()

    @app.get("/auth")
    def read_auth(authorization: str | None = Header(default=None)):
        return {"authorization": authorization}

    client = FastAPITestClient(app)
    client.authenticate_basic("alice", "wonderland")

    encoded = b64encode(b"alice:wonderland").decode("ascii")
    assert client.get("/auth").json() == {"authorization": f"Basic {encoded}"}


def test_ws_connect_supports_headers_and_subprotocols():
    app = FastAPI()

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        await websocket.accept()
        await websocket.send_json(
            {
                "custom_header": websocket.headers.get("x-client-token"),
                "subprotocols": websocket.scope["subprotocols"],
            }
        )
        await websocket.close()

    client = FastAPITestClient(app)

    with client.ws_connect(
        "/ws", headers={"x-client-token": "secret"}, subprotocols=["chat"]
    ) as websocket:
        assert websocket.receive_json() == {
            "custom_header": "secret",
            "subprotocols": ["chat"],
        }


def test_assert_status_returns_response_and_reports_expected_and_actual_status():
    app = FastAPI()

    @app.post("/items", status_code=201)
    def create_item():
        return {"created": True}

    client = FastAPITestClient(app)

    response = client.assert_status("POST", "/items", 201)
    assert response.json() == {"created": True}

    with pytest.raises(
        AssertionError,
        match="Expected status code 200 for POST /items, got 201.",
    ):
        client.assert_status("POST", "/items", 200)
