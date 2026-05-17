"""Tests for FastAPITestClient."""
import base64
import pytest
from fastapi import FastAPI, WebSocket
from fastapi.testclient import FastAPITestClient, TestClient


app = FastAPI()


@app.get("/me")
def get_me():
    return {"user": "testuser"}


@app.get("/secure")
def secure_endpoint():
    from fastapi import Header
    return {"msg": "ok"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    data = await websocket.receive_text()
    await websocket.send_text(f"echo: {data}")


def test_authenticate_bearer():
    """authenticate sets Bearer token for all requests."""
    client = FastAPITestClient(app)
    client.authenticate("tokensecret123")

    response = client.get("/me")
    assert response.status_code == 200
    assert response.json() == {"user": "testuser"}


def test_authenticate_basic():
    """authenticate_basic encodes credentials."""
    client = FastAPITestClient(app)
    client.authenticate_basic("admin", "password")

    assert "Authorization" in client._auth_headers
    assert client._auth_headers["Authorization"].startswith("Basic ")

    # Decode and verify
    encoded = client._auth_headers["Authorization"][6:]
    decoded = base64.b64decode(encoded).decode()
    assert decoded == "admin:password"


def test_token_replacement():
    """Calling authenticate again replaces token."""
    client = FastAPITestClient(app)
    client.authenticate("old_token")
    client.authenticate("new_token")

    assert client._auth_headers["Authorization"] == "Bearer new_token"


def test_reset_auth():
    """reset_auth clears auth state."""
    client = FastAPITestClient(app)
    client.authenticate("token123")
    client.reset_auth()

    assert len(client._auth_headers) == 0


def test_assert_status_success():
    """assert_status passes on matching status."""
    client = FastAPITestClient(app)
    response = client.assert_status("GET", "/me", 200)
    assert response.status_code == 200


def test_assert_status_failure():
    """assert_status raises on mismatch."""
    client = FastAPITestClient(app)
    with pytest.raises(AssertionError, match="Expected status 404"):
        client.assert_status("GET", "/me", 404)


def test_existing_import():
    """Existing TestClient import still works."""
    assert TestClient is not None
    tc = TestClient(app)
    response = tc.get("/me")
    assert response.status_code == 200