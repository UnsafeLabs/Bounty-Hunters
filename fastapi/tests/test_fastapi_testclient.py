"""Tests for FastAPITestClient helper methods."""
from __future__ import annotations

import pytest
from fastapi import FastAPI, WebSocket
from fastapi.testclient import FastAPITestClient

app = FastAPI()


@app.get("/public")
async def public_endpoint():
    return {"message": "public"}


@app.get("/protected")
async def protected_endpoint():
    return {"message": "protected"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    data = await websocket.receive_text()
    await websocket.send_text(f"Echo: {data}")
    await websocket.close()


@pytest.fixture
def client() -> FastAPITestClient:
    return FastAPITestClient(app)


class TestAuthenticate:
    def test_sets_bearer_token(self, client: FastAPITestClient) -> None:
        client.authenticate("test-token")
        assert client._auth_headers["Authorization"] == "Bearer test-token"

    def test_replaces_previous_token(self, client: FastAPITestClient) -> None:
        client.authenticate("token-1")
        client.authenticate("token-2")
        assert client._auth_headers["Authorization"] == "Bearer token-2"

    def test_returns_self_for_chaining(self, client: FastAPITestClient) -> None:
        result = client.authenticate("token")
        assert result is client


class TestAuthenticateBasic:
    def test_encodes_credentials(self, client: FastAPITestClient) -> None:
        client.authenticate_basic("user", "pass")
        assert client._auth_headers["Authorization"].startswith("Basic ")

    def test_returns_self_for_chaining(self, client: FastAPITestClient) -> None:
        result = client.authenticate_basic("user", "pass")
        assert result is client


class TestResetAuth:
    def test_clears_auth_state(self, client: FastAPITestClient) -> None:
        client.authenticate("token")
        client.reset_auth()
        assert client._auth_token is None
        assert client._auth_headers == {}

    def test_returns_self_for_chaining(self, client: FastAPITestClient) -> None:
        result = client.reset_auth()
        assert result is client


class TestAssertStatus:
    def test_passes_on_matching_status(self, client: FastAPITestClient) -> None:
        response = client.assert_status("GET", "/public", 200)
        assert response.status_code == 200

    def test_raises_on_mismatched_status(self, client: FastAPITestClient) -> None:
        with pytest.raises(AssertionError, match="Expected status 201"):
            client.assert_status("GET", "/public", 201)


class TestWsConnect:
    def test_websocket_connection(self, client: FastAPITestClient) -> None:
        with client.ws_connect("/ws") as ws:
            ws.send_text("hello")
            data = ws.receive_text()
            assert data == "Echo: hello"
