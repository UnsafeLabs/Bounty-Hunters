from fastapi import FastAPI, Header, WebSocket
from fastapi.testclient import FastAPITestClient, TestClient


def test_existing_testclient_export_is_unchanged():
    assert TestClient is not FastAPITestClient


def test_fastapi_testclient_authenticate_sets_bearer_token():
    app = FastAPI()

    @app.get("/")
    def read_root(authorization: str = Header()):
        return {"authorization": authorization}

    client = FastAPITestClient(app)
    client.authenticate("first")
    assert client.get("/").json() == {"authorization": "Bearer first"}

    client.authenticate("second")
    assert client.get("/").json() == {"authorization": "Bearer second"}


def test_fastapi_testclient_authenticate_basic_and_reset_auth():
    app = FastAPI()

    @app.get("/")
    def read_root(authorization: str | None = Header(default=None)):
        return {"authorization": authorization}

    client = FastAPITestClient(app)
    client.authenticate_basic("alice", "secret")
    assert client.get("/").json() == {"authorization": "Basic YWxpY2U6c2VjcmV0"}

    client.reset_auth()
    assert client.get("/").json() == {"authorization": None}


def test_fastapi_testclient_ws_connect_supports_headers_and_subprotocols():
    app = FastAPI()

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        await websocket.accept(subprotocol=websocket.scope["subprotocols"][0])
        await websocket.send_json(
            {
                "x-token": websocket.headers["x-token"],
                "subprotocol": websocket.scope["subprotocols"][0],
            }
        )
        await websocket.close()

    client = FastAPITestClient(app)

    with client.ws_connect(
        "/ws",
        headers={"x-token": "abc"},
        subprotocols=["chat"],
    ) as websocket:
        assert websocket.accepted_subprotocol == "chat"
        assert websocket.receive_json() == {"x-token": "abc", "subprotocol": "chat"}


def test_fastapi_testclient_assert_status_returns_response():
    app = FastAPI()

    @app.get("/")
    def read_root():
        return {"ok": True}

    response = FastAPITestClient(app).assert_status("GET", "/", 200)

    assert response.json() == {"ok": True}


def test_fastapi_testclient_assert_status_raises_helpful_error():
    app = FastAPI()

    @app.get("/")
    def read_root():
        return {"ok": True}

    try:
        FastAPITestClient(app).assert_status("GET", "/", 201)
    except AssertionError as exc:
        assert "Expected status 201, got 200" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("Expected assert_status to fail")
