import base64

from fastapi import FastAPI, Header, WebSocket
from fastapi.testclient import FastAPITestClient, TestClient
from starlette.testclient import TestClient as StarletteTestClient


def test_testclient_keeps_starlette_alias() -> None:
    assert TestClient is StarletteTestClient


def test_authenticate_sets_bearer_header_for_later_requests() -> None:
    app = FastAPI()

    @app.get("/headers")
    def get_headers(
        authorization: str | None = Header(default=None),
    ) -> dict[str, str | None]:
        return {"authorization": authorization}

    client = FastAPITestClient(app)
    client.authenticate("secret-token")

    response = client.get("/headers")

    assert response.json() == {"authorization": "Bearer secret-token"}


def test_authenticate_basic_sets_encoded_basic_header() -> None:
    app = FastAPI()

    @app.get("/headers")
    def get_headers(
        authorization: str | None = Header(default=None),
    ) -> dict[str, str | None]:
        return {"authorization": authorization}

    client = FastAPITestClient(app)
    client.authenticate_basic("alice", "s3cret")

    encoded = base64.b64encode(b"alice:s3cret").decode("ascii")
    response = client.get("/headers")

    assert response.json() == {"authorization": f"Basic {encoded}"}


def test_ws_connect_merges_auth_and_custom_headers_with_subprotocols() -> None:
    app = FastAPI()

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket) -> None:
        await websocket.accept(subprotocol="chat")
        await websocket.send_json(
            {
                "authorization": websocket.headers.get("authorization"),
                "trace": websocket.headers.get("x-trace-id"),
                "subprotocol": websocket.scope.get("subprotocols"),
            }
        )
        await websocket.close()

    client = FastAPITestClient(app)
    client.authenticate("ws-token")

    with client.ws_connect(
        "/ws",
        headers={"X-Trace-ID": "abc-123"},
        subprotocols=["chat"],
    ) as websocket:
        assert websocket.receive_json() == {
            "authorization": "Bearer ws-token",
            "trace": "abc-123",
            "subprotocol": ["chat"],
        }


def test_assert_status_returns_response_when_expected_status_matches() -> None:
    app = FastAPI()

    @app.post("/items", status_code=201)
    def create_item() -> dict[str, bool]:
        return {"ok": True}

    client = FastAPITestClient(app)

    response = client.assert_status("POST", "/items", 201)

    assert response.json() == {"ok": True}


def test_assert_status_raises_when_status_does_not_match() -> None:
    app = FastAPI()

    @app.get("/items")
    def list_items() -> dict[str, bool]:
        return {"ok": True}

    client = FastAPITestClient(app)

    try:
        client.assert_status("GET", "/items", 201)
    except AssertionError as exc:
        assert "Expected 201 for GET /items, got 200" in str(exc)
    else:
        raise AssertionError("assert_status should raise when the status differs")
