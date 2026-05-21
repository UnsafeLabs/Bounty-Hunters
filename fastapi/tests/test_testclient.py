import pytest
from fastapi import FastAPI
from fastapi.testclient import FastAPITestClient
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.testclient import TestClient
from starlette.websockets import WebSocket


@pytest.fixture
def app():
    api = FastAPI()

    @api.get("/me")
    def get_me():
        return {"user": "test"}

    @api.post("/data")
    def post_data():
        return {"ok": True}

    @api.websocket("/ws")
    async def ws_endpoint(websocket: WebSocket):
        await websocket.accept()
        await websocket.close()

    @api.get("/protected")
    def protected(request: Request):
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        return {"user": "test"}

    @api.get("/basic-protected")
    def basic_protected(request: Request):
        auth = request.headers.get("Authorization", "")
        if auth != "Basic dGVzdDpwYXNz":
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        return {"user": "test"}

    return api


def test_fastapi_testclient_inherits_testclient(app):
    client = FastAPITestClient(app)
    assert isinstance(client, TestClient)


def test_authenticate_sets_bearer_token(app):
    client = FastAPITestClient(app)
    client.authenticate("my-token")
    response = client.get("/protected")
    assert response.status_code == 200
    assert response.json() == {"user": "test"}


def test_authenticate_replaces_previous_token(app):
    client = FastAPITestClient(app)
    client.authenticate("first-token")
    client.authenticate("second-token")
    response = client.get("/protected")
    assert response.status_code == 200


def test_reset_auth_clears_token(app):
    client = FastAPITestClient(app)
    client.authenticate("my-token")
    client.reset_auth()
    response = client.get("/protected")
    assert response.status_code == 401


def test_authenticate_basic(app):
    client = FastAPITestClient(app)
    client.authenticate_basic("test", "pass")
    response = client.get("/basic-protected")
    assert response.status_code == 200


def test_authenticate_basic_invalid_credentials(app):
    client = FastAPITestClient(app)
    client.authenticate_basic("wrong", "wrong")
    response = client.get("/basic-protected")
    assert response.status_code == 401


def test_assert_status_passes(app):
    client = FastAPITestClient(app)
    response = client.assert_status("GET", "/me", 200)
    assert response.json() == {"user": "test"}


def test_assert_status_raises_on_mismatch(app):
    client = FastAPITestClient(app)
    with pytest.raises(AssertionError, match="Expected status 404"):
        client.assert_status("GET", "/me", 404)


def test_request_custom_header_overrides_auth(app):
    client = FastAPITestClient(app)
    client.authenticate("my-token")
    response = client.get("/protected", headers={"X-Custom": "value"})
    assert response.status_code == 200


def test_without_auth_works_fine(app):
    client = FastAPITestClient(app)
    response = client.get("/me")
    assert response.json() == {"user": "test"}


def test_existing_testclient_import_unaffected(app):
    client = TestClient(app)
    response = client.get("/me")
    assert response.json() == {"user": "test"}


def test_ws_connect_with_auth(app):
    client = FastAPITestClient(app)
    client.authenticate("ws-token")
    with client.ws_connect("/ws"):
        pass


def test_ws_connect_with_custom_headers(app):
    client = FastAPITestClient(app)
    with client.ws_connect("/ws", headers={"X-Custom": "value"}):
        pass


def test_ws_connect_without_auth(app):
    client = FastAPITestClient(app)
    with client.ws_connect("/ws"):
        pass


def test_assert_status_with_body(app):
    client = FastAPITestClient(app)
    response = client.assert_status("POST", "/data", 200, json={"key": "val"})
    assert response.json() == {"ok": True}


def test_authenticate_basic_encoding():
    """Verify the base64 encoding is correct."""
    import base64
    raw = base64.b64encode(b"test:pass").decode("ascii")
    assert raw == "dGVzdDpwYXNz"
