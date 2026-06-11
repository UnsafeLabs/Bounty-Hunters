import base64
from typing import Annotated

import pytest
from fastapi import Depends, FastAPI, Header, Response, WebSocket
from fastapi.testclient import FastAPITestClient, TestClient
from starlette.testclient import TestClient as StarletteTestClient

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
def read_status(status_code: int) -> Response:
    return Response(status_code=status_code)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    subprotocol = websocket.scope["subprotocols"][0]
    await websocket.accept(subprotocol=subprotocol)
    await websocket.send_json(
        {
            "authorization": websocket.headers.get("authorization"),
            "client": websocket.headers.get("x-client"),
            "subprotocol": subprotocol,
        }
    )
    await websocket.close()


def test_existing_testclient_export_and_behavior_are_unchanged() -> None:
    assert TestClient is StarletteTestClient
    assert TestClient is not FastAPITestClient
    assert issubclass(FastAPITestClient, TestClient)
    assert not hasattr(TestClient, "authenticate")

    client = TestClient(app)
    assert client.get("/auth").json() == {"authorization": None}


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


def test_reset_auth_clears_authorization_header_without_losing_other_headers() -> None:
    client = FastAPITestClient(app, headers={"x-client": "suite"})

    client.authenticate("token").reset_auth()

    assert client.get("/auth").json() == {"authorization": None}
    assert client.headers["x-client"] == "suite"


def test_ws_connect_merges_auth_custom_headers_and_subprotocols() -> None:
    client = FastAPITestClient(app).authenticate("ws-token")

    with client.ws_connect(
        "/ws",
        headers={"x-client": "test-suite"},
        subprotocols=("chat",),
    ) as websocket:
        assert websocket.receive_json() == {
            "authorization": "Bearer ws-token",
            "client": "test-suite",
            "subprotocol": "chat",
        }
        assert websocket.accepted_subprotocol == "chat"


def test_ws_connect_custom_headers_can_override_auth_case_insensitively() -> None:
    client = FastAPITestClient(app).authenticate("default-token")

    with client.ws_connect(
        "/ws",
        headers=[("authorization", "Bearer override-token"), ("x-client", "tuple")],
        subprotocols=["updates"],
    ) as websocket:
        assert websocket.receive_json() == {
            "authorization": "Bearer override-token",
            "client": "tuple",
            "subprotocol": "updates",
        }


def test_assert_status_returns_response_on_expected_status() -> None:
    client = FastAPITestClient(app)

    response = client.assert_status("GET", "/status/204", 204)

    assert response.status_code == 204


def test_assert_status_accepts_named_status_code() -> None:
    client = FastAPITestClient(app)

    response = client.assert_status("GET", "/status/201", status_code=201)

    assert response.status_code == 201


def test_assert_status_raises_helpful_message() -> None:
    client = FastAPITestClient(app)

    with pytest.raises(
        AssertionError,
        match=(
            "Expected status code 201 for GET /auth; actual status code 200"
        ),
    ):
        client.assert_status("GET", "/auth", 201)
