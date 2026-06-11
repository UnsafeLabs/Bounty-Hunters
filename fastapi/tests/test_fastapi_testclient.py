import base64
from typing import Annotated

import pytest
from fastapi import Depends, FastAPI, Header, WebSocket
from fastapi.testclient import FastAPITestClient, TestClient


app = FastAPI()


def authorization_header(
    authorization: Annotated[str | None, Header()] = None,
) -> str | None:
    return authorization


@app.get("/auth")
def read_auth(
    authorization: Annotated[str | None, Depends(authorization_header)] = None,
) -> dict[str, str | None]:
    return {"authorization": authorization}


@app.get("/status/{status_code}")
def read_status(status_code: int) -> dict[str, int]:
    return {"status_code": status_code}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept(subprotocol=websocket.scope["subprotocols"][0])
    await websocket.send_json(
        {
            "authorization": websocket.headers.get("authorization"),
            "client": websocket.headers.get("x-client"),
            "subprotocol": websocket.scope["subprotocols"][0],
        }
    )
    await websocket.close()


def test_existing_testclient_export_is_unchanged() -> None:
    assert TestClient is not FastAPITestClient
    assert issubclass(FastAPITestClient, TestClient)


def test_authenticate_sets_and_replaces_bearer_token() -> None:
    client = FastAPITestClient(app)

    client.authenticate("first-token")
    assert client.get("/auth").json() == {"authorization": "Bearer first-token"}

    client.authenticate("second-token")
    assert client.get("/auth").json() == {"authorization": "Bearer second-token"}


def test_authenticate_basic_sets_basic_header() -> None:
    client = FastAPITestClient(app)
    expected = base64.b64encode(b"alice:s3cret").decode("ascii")

    client.authenticate_basic("alice", "s3cret")

    assert client.get("/auth").json() == {"authorization": f"Basic {expected}"}


def test_reset_auth_clears_authorization_header() -> None:
    client = FastAPITestClient(app)

    client.authenticate("token").reset_auth()

    assert client.get("/auth").json() == {"authorization": None}


def test_ws_connect_merges_auth_custom_headers_and_subprotocols() -> None:
    client = FastAPITestClient(app).authenticate("ws-token")

    with client.ws_connect(
        "/ws",
        headers={"x-client": "test-suite"},
        subprotocols=["chat"],
    ) as websocket:
        assert websocket.receive_json() == {
            "authorization": "Bearer ws-token",
            "client": "test-suite",
            "subprotocol": "chat",
        }


def test_assert_status_returns_response_on_expected_status() -> None:
    client = FastAPITestClient(app)

    response = client.assert_status("GET", "/status/204", 200)

    assert response.json() == {"status_code": 204}


def test_assert_status_raises_helpful_message() -> None:
    client = FastAPITestClient(app)

    with pytest.raises(AssertionError, match="Expected 201 for GET /auth, got 200"):
        client.assert_status("GET", "/auth", 201)
