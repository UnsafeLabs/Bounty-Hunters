"""
Tests for FastAPITestClient
"""
import pytest
from fastapi import FastAPI, WebSocket, Header, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import JSONResponse
from testclient import FastAPITestClient


# Test app setup
app = FastAPI(title="Test App")
security = HTTPBearer(auto_error=False)


# Dependency for token verification
async def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not credentials:
        raise HTTPException(status_code=401, detail="Missing token")
    if credentials.credentials != "valid-token":
        raise HTTPException(status_code=401, detail="Invalid token")
    return credentials.credentials


# Routes
@app.get("/public")
async def public_endpoint():
    return {"message": "public"}


@app.get("/protected")
async def protected_endpoint(token: str = Depends(verify_token)):
    return {"message": "protected", "token": token}


@app.get("/basic-auth")
async def basic_auth_endpoint(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Basic "):
        raise HTTPException(status_code=401, detail="Missing basic auth")
    return {"message": "basic-auth", "auth": authorization}


@app.get("/status/{code}")
async def status_endpoint(code: int):
    return JSONResponse(content={"code": code}, status_code=code)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    data = await websocket.receive_text()
    await websocket.send_text(f"echo: {data}")
    await websocket.close()


@app.websocket("/ws-auth")
async def websocket_auth_endpoint(websocket: WebSocket):
    await websocket.accept()
    auth = websocket.headers.get("authorization", "")
    if not auth:
        await websocket.close(code=4001)
        return
    await websocket.send_text(f"auth: {auth}")
    data = await websocket.receive_text()
    await websocket.send_text(f"echo: {data}")
    await websocket.close()


# Tests
class TestFastAPITestClient:
    def setup_method(self):
        self.client = FastAPITestClient(app)

    def test_public_endpoint(self):
        """Test that public endpoint works without auth."""
        response = self.client.get("/public")
        assert response.status_code == 200
        assert response.json() == {"message": "public"}

    def test_protected_without_auth(self):
        """Test that protected endpoint fails without auth."""
        response = self.client.get("/protected")
        assert response.status_code == 401

    def test_authenticate_sets_bearer(self):
        """Test that authenticate() sets Bearer token."""
        self.client.authenticate("valid-token")
        response = self.client.get("/protected")
        assert response.status_code == 200
        assert response.json()["token"] == "valid-token"

    def test_authenticate_replaces_token(self):
        """Test that calling authenticate again replaces the token."""
        self.client.authenticate("wrong-token")
        response = self.client.get("/protected")
        assert response.status_code == 401

        self.client.authenticate("valid-token")
        response = self.client.get("/protected")
        assert response.status_code == 200

    def test_authenticate_basic(self):
        """Test that authenticate_basic() sets Basic auth."""
        self.client.authenticate_basic("user", "pass")
        response = self.client.get("/basic-auth")
        assert response.status_code == 200
        assert "Basic " in response.json()["auth"]

    def test_authenticate_basic_encoding(self):
        """Test that Basic auth properly base64 encodes credentials."""
        self.client.authenticate_basic("admin", "secret123")
        response = self.client.get("/basic-auth")
        assert response.status_code == 200
        import base64
        expected = base64.b64encode(b"admin:secret123").decode()
        assert expected in response.json()["auth"]

    def test_reset_auth(self):
        """Test that reset_auth() clears authentication."""
        self.client.authenticate("valid-token")
        response = self.client.get("/protected")
        assert response.status_code == 200

        self.client.reset_auth()
        response = self.client.get("/protected")
        assert response.status_code == 401

    def test_assert_status_success(self):
        """Test assert_status with matching status code."""
        response = self.client.assert_status("GET", "/public", expected_status=200)
        assert response.status_code == 200

    def test_assert_status_failure(self):
        """Test assert_status with wrong status code raises AssertionError."""
        with pytest.raises(AssertionError) as exc_info:
            self.client.assert_status("GET", "/public", expected_status=404)
        assert "Expected status 404" in str(exc_info.value)
        assert "got 200" in str(exc_info.value)

    def test_assert_status_with_dynamic_route(self):
        """Test assert_status with dynamic routes."""
        response = self.client.assert_status("GET", "/status/201", expected_status=201)
        assert response.status_code == 201

    def test_assert_status_500(self):
        """Test assert_status for error status codes."""
        response = self.client.assert_status("GET", "/status/500", expected_status=500)
        assert response.status_code == 500

    def test_custom_headers(self):
        """Test that custom headers are preserved alongside auth."""
        self.client.authenticate("valid-token")
        response = self.client.get(
            "/protected",
            headers={"X-Custom": "test-value"},
        )
        assert response.status_code == 200

    def test_method_chaining(self):
        """Test that authenticate methods support chaining."""
        response = (
            self.client
            .authenticate("valid-token")
            .request("GET", "/protected")
        )
        assert response.status_code == 200

        response = (
            self.client
            .reset_auth()
            .request("GET", "/public")
        )
        assert response.status_code == 200

    def test_auth_headers_independent_of_request(self):
        """Test that auth headers don't leak between requests."""
        self.client.authenticate("valid-token")
        resp1 = self.client.get("/protected")
        assert resp1.status_code == 200

        self.client.reset_auth()
        resp2 = self.client.get("/protected")
        assert resp2.status_code == 401

    def test_get_auth_headers(self):
        """Test _get_auth_headers returns correct headers."""
        # No auth
        assert self.client._get_auth_headers() == {}

        # Bearer
        self.client.authenticate("my-token")
        headers = self.client._get_auth_headers()
        assert headers["Authorization"] == "Bearer my-token"

        # Basic
        self.client.authenticate_basic("u", "p")
        headers = self.client._get_auth_headers()
        assert headers["Authorization"].startswith("Basic ")

        # Reset
        self.client.reset_auth()
        assert self.client._get_auth_headers() == {}


class TestWebSocket:
    def setup_method(self):
        self.client = FastAPITestClient(app)

    def test_ws_basic(self):
        """Test basic WebSocket connection."""
        with self.client.ws_connect("/ws") as ws:
            ws.send_text("hello")
            data = ws.receive_text()
            assert data == "echo: hello"

    def test_ws_with_auth_header(self):
        """Test WebSocket with authentication header."""
        with self.client.ws_connect(
            "/ws-auth",
            headers={"Authorization": "Bearer valid-token"},
        ) as ws:
            auth_msg = ws.receive_text()
            assert "Bearer valid-token" in auth_msg
            ws.send_text("test")
            echo_msg = ws.receive_text()
            assert echo_msg == "echo: test"


class TestIntegration:
    """Integration tests combining multiple features."""

    def test_full_workflow(self):
        """Test a complete authentication workflow."""
        client = FastAPITestClient(app)

        # Start unauthenticated
        resp = client.get("/protected")
        assert resp.status_code == 401

        # Authenticate
        client.authenticate("valid-token")
        resp = client.get("/protected")
        assert resp.status_code == 200

        # Switch to basic auth
        client.authenticate_basic("user", "pass")
        resp = client.get("/basic-auth")
        assert resp.status_code == 200

        # Reset and verify
        client.reset_auth()
        resp = client.get("/protected")
        assert resp.status_code == 401
