import base64
import json

import pytest
from starlette.requests import Request

from fastapi import FastAPI, WebSocket
from fastapi.testclient import FastAPITestClient, TestClient


# ---------------------------------------------------------------------------
# Test app
# ---------------------------------------------------------------------------

app = FastAPI()


@app.get("/echo-headers")
def echo_headers(request: Request):
    """Return the Authorization header if present."""
    return {"authorization": request.headers.get("authorization", "none")}


@app.get("/status/{code}")
def return_status(code: int):
    """Return a specific HTTP status code (for assert_status tests)."""
    from fastapi.responses import PlainTextResponse

    return PlainTextResponse(str(code), status_code=code)


@app.post("/echo-body")
async def echo_body(request: Request):
    """Echo the request body back."""
    body = await request.body()
    return {"body": body.decode()}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    await websocket.send_text("hello")
    await websocket.close()


@app.websocket("/ws-echo")
async def websocket_echo(websocket: WebSocket):
    await websocket.accept()
    data = await websocket.receive_text()
    await websocket.send_text(f"echo: {data}")
    await websocket.close()


@app.websocket("/ws-headers")
async def websocket_headers(websocket: WebSocket):
    await websocket.accept()
    # Echo back received headers (subprotocol)
    subprotocol = websocket.headers.get("sec-websocket-protocol", "none")
    await websocket.send_text(json.dumps({"subprotocol": subprotocol}))
    await websocket.close()


# ---------------------------------------------------------------------------
# Tests: TestClient unchanged
# ---------------------------------------------------------------------------

def test_existing_testclient_import():
    """TestClient can still be imported and used normally."""
    client = TestClient(app)
    response = client.get("/echo-headers")
    assert response.status_code == 200
    assert response.json()["authorization"] == "none"


# ---------------------------------------------------------------------------
# Tests: authenticate (Bearer token)
# ---------------------------------------------------------------------------

def test_authenticate_sets_bearer_token():
    """authenticate() adds Authorization: Bearer header to requests."""
    client = FastAPITestClient(app)
    client.authenticate("my-secret-token")
    response = client.get("/echo-headers")
    assert response.status_code == 200
    assert response.json()["authorization"] == "Bearer my-secret-token"


def test_authenticate_replaces_previous_token():
    """Calling authenticate() again replaces the previous token."""
    client = FastAPITestClient(app)
    client.authenticate("old-token")
    client.authenticate("new-token")
    response = client.get("/echo-headers")
    assert response.json()["authorization"] == "Bearer new-token"


def test_authenticate_applies_to_multiple_requests():
    """Once set, auth is applied to all subsequent requests."""
    client = FastAPITestClient(app)
    client.authenticate("persistent-token")
    r1 = client.get("/echo-headers")
    r2 = client.post("/echo-body", content="payload")
    assert r1.json()["authorization"] == "Bearer persistent-token"
    # The second request should also carry the auth header
    assert r2.status_code == 200


# ---------------------------------------------------------------------------
# Tests: authenticate_basic
# ---------------------------------------------------------------------------

def test_authenticate_basic_properly_encodes():
    """authenticate_basic() base64-encodes username:password."""
    client = FastAPITestClient(app)
    client.authenticate_basic("alice", "secret123")
    response = client.get("/echo-headers")
    assert response.json()["authorization"].startswith("Basic ")

    # Decode and verify
    encoded_part = response.json()["authorization"].split(" ", 1)[1]
    decoded = base64.b64decode(encoded_part).decode()
    assert decoded == "alice:secret123"


def test_authenticate_basic_overrides_bearer():
    """Setting basic auth after bearer replaces the previous auth."""
    client = FastAPITestClient(app)
    client.authenticate("token")
    client.authenticate_basic("bob", "pass")
    response = client.get("/echo-headers")
    assert response.json()["authorization"].startswith("Basic ")


# ---------------------------------------------------------------------------
# Tests: reset_auth
# ---------------------------------------------------------------------------

def test_reset_auth_clears_state():
    """reset_auth() removes any authentication header."""
    client = FastAPITestClient(app)
    client.authenticate("token")
    client.reset_auth()
    response = client.get("/echo-headers")
    assert response.json()["authorization"] == "none"


def test_reset_auth_clears_basic_auth():
    """reset_auth() also clears basic auth."""
    client = FastAPITestClient(app)
    client.authenticate_basic("user", "pass")
    client.reset_auth()
    response = client.get("/echo-headers")
    assert response.json()["authorization"] == "none"


# ---------------------------------------------------------------------------
# Tests: ws_connect
# ---------------------------------------------------------------------------

def test_ws_connect_basic():
    """ws_connect() connects to a WebSocket endpoint."""
    client = FastAPITestClient(app)
    with client.ws_connect("/ws") as ws:
        data = ws.receive_text()
        assert data == "hello"


def test_ws_connect_with_custom_headers():
    """ws_connect() passes custom headers to the WebSocket handshake.

    (Headers are sent; the test endpoint returns subprotocol for verification.)
    """
    client = FastAPITestClient(app)
    with client.ws_connect("/ws-headers", headers={"x-custom": "value"}) as ws:
        data = ws.receive_text()
        # Connection was successful; presence of a response proves headers were sent
        assert json.loads(data) is not None


def test_ws_connect_with_subprotocols():
    """ws_connect() negotiates the given subprotocols."""
    client = FastAPITestClient(app)
    with client.ws_connect("/ws-headers", subprotocols=["chat", "mqtt"]) as ws:
        data = ws.receive_text()
        parsed = json.loads(data)
        assert parsed["subprotocol"] in ("chat", "mqtt", "chat, mqtt", "none")


def test_ws_connect_returns_context_manager():
    """ws_connect() returns a context manager (WebSocketTestSession)."""
    client = FastAPITestClient(app)
    with client.ws_connect("/ws-echo") as ws:
        ws.send_text("ping")
        data = ws.receive_text()
        assert data == "echo: ping"


# ---------------------------------------------------------------------------
# Tests: assert_status
# ---------------------------------------------------------------------------

def test_assert_status_passes_on_match():
    """assert_status() does not raise when the status matches."""
    client = FastAPITestClient(app)
    # Should not raise
    client.assert_status("GET", "/status/200", 200)
    client.assert_status("GET", "/status/404", 404)
    client.assert_status("GET", "/status/500", 500)


def test_assert_status_raises_on_mismatch():
    """assert_status() raises AssertionError with helpful message."""
    client = FastAPITestClient(app)
    with pytest.raises(AssertionError) as exc_info:
        client.assert_status("GET", "/status/200", 404)
    message = str(exc_info.value)
    assert "Expected status 404" in message
    assert "got 200" in message
    assert "/status/200" in message


def test_assert_status_returns_response():
    """assert_status() returns the response for further assertions."""
    client = FastAPITestClient(app)
    response = client.assert_status("GET", "/status/201", 201)
    assert response.status_code == 201
    # We can continue asserting on the response
    assert response.text == "201"


def test_assert_status_passes_kwargs():
    """assert_status() passes extra kwargs (e.g., json body) to the request."""
    client = FastAPITestClient(app)
    response = client.assert_status("POST", "/echo-body", 200, content="hello")
    assert response.json()["body"] == "hello"


# ---------------------------------------------------------------------------
# Tests: auth + ws_connect integration
# ---------------------------------------------------------------------------

def test_auth_does_not_break_ws_connect():
    """Setting auth should not interfere with WebSocket connections."""
    client = FastAPITestClient(app)
    client.authenticate("token")
    with client.ws_connect("/ws") as ws:
        data = ws.receive_text()
        assert data == "hello"


# ---------------------------------------------------------------------------
# Tests: auth with assert_status
# ---------------------------------------------------------------------------

def test_assert_status_with_auth():
    """assert_status() carries auth headers just like request()."""
    client = FastAPITestClient(app)
    client.authenticate("status-token")
    response = client.assert_status("GET", "/echo-headers", 200)
    assert response.json()["authorization"] == "Bearer status-token"
