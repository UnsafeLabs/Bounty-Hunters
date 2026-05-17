import base64
import pytest
from fastapi import FastAPI
from fastapi.testclient import FastAPITestClient, TestClient

app = FastAPI()

@app.get("/me")
def get_me():
    return {"user": "testuser"}

def test_authenticate_bearer():
    client = FastAPITestClient(app)
    client.authenticate("tokensecret123")
    response = client.get("/me")
    assert response.status_code == 200
    assert response.json() == {"user": "testuser"}

def test_authenticate_basic():
    client = FastAPITestClient(app)
    client.authenticate_basic("admin", "password")
    assert client._auth_headers["Authorization"].startswith("Basic ")
    encoded = client._auth_headers["Authorization"][6:]
    decoded = base64.b64decode(encoded).decode()
    assert decoded == "admin:password"

def test_token_replacement():
    client = FastAPITestClient(app)
    client.authenticate("old")
    client.authenticate("new")
    assert client._auth_headers["Authorization"] == "Bearer new"

def test_reset_auth():
    client = FastAPITestClient(app)
    client.authenticate("token")
    client.reset_auth()
    assert len(client._auth_headers) == 0

def test_assert_status_success():
    client = FastAPITestClient(app)
    resp = client.assert_status("GET", "/me", 200)
    assert resp.status_code == 200

def test_assert_status_failure():
    client = FastAPITestClient(app)
    with pytest.raises(AssertionError, match="Expected status 404"):
        client.assert_status("GET", "/me", 404)

def test_existing_import():
    assert TestClient is not None
    tc = TestClient(app)
    assert tc.get("/me").status_code == 200
