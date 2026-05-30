import base64

import pytest
from fastapi import FastAPI, Header, Response, WebSocket
from fastapi.testclient import FastAPITestClient, TestClient

app = FastAPI()


@app.get("/authorization")
def read_authorization(
    authorization: str | None = Header(default=None),
) -> dict[str, str | None]:
    return {"authorization": authorization}


@app.get("/status/{status_code}")
def read_status(status_code: int, response: Response) -> dict[str, int]:
    response.status_code = status_code
    return {"status_code": status_code}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    subprotocol = websocket.headers.get("sec-websocket-protocol")
    selected_subprotocol = subprotocol.split(",")[0].strip() if subprotocol else None
    await websocket.accept(subprotocol=selected_subprotocol)
    await websocket.send_json(
        {
            "x-client": websocket.headers.get("x-client"),
            "subprotocol": selected_subprotocol,
        }
    )
    await websocket.close()


def test_existing_testclient_export_is_unchanged() -> None:
    client = TestClient(app)

    response = client.get("/authorization")

    assert response.json() == {"authorization": None}


def test_authenticate_sets_bearer_token_for_following_requests() -> None:
    client = FastAPITestClient(app)

    client.authenticate("token-123")
    response = client.get("/authorization")

    assert response.json() == {"authorization": "Bearer token-123"}


def test_authenticate_replaces_previous_token() -> None:
    client = FastAPITestClient(app)

    client.authenticate("old-token")
    client.authenticate("new-token")
    response = client.get("/authorization")

    assert response.json() == {"authorization": "Bearer new-token"}


def test_authenticate_basic_sets_encoded_credentials() -> None:
    client = FastAPITestClient(app)

    client.authenticate_basic("user", "pass")
    response = client.get("/authorization")

    expected = base64.b64encode(b"user:pass").decode("ascii")
    assert response.json() == {"authorization": f"Basic {expected}"}


def test_reset_auth_clears_authentication_state() -> None:
    client = FastAPITestClient(app)

    client.authenticate("token-123")
    client.reset_auth()
    response = client.get("/authorization")

    assert response.json() == {"authorization": None}


def test_ws_connect_accepts_custom_headers_and_subprotocols() -> None:
    client = FastAPITestClient(app)

    with client.ws_connect(
        "/ws", headers={"x-client": "test"}, subprotocols=["chat"]
    ) as session:
        assert session.receive_json() == {"x-client": "test", "subprotocol": "chat"}


def test_assert_status_returns_response_for_expected_status() -> None:
    client = FastAPITestClient(app)

    response = client.assert_status("GET", "/status/201", 201)

    assert response.status_code == 201


def test_assert_status_raises_helpful_assertion_for_unexpected_status() -> None:
    client = FastAPITestClient(app)

    with pytest.raises(
        AssertionError, match="Expected GET /status/404 to return 200, got 404"
    ):
        client.assert_status("GET", "/status/404", 200)
