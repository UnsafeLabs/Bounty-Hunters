import json

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str


class NestedRequest(BaseModel):
    user: LoginRequest
    token: str


class SimpleRequest(BaseModel):
    name: str
    age: int


app = FastAPI()
debug_app = FastAPI(debug=True)


@app.post("/login")
def login(body: LoginRequest):
    return {"ok": True}  # pragma: no cover


@app.post("/nested")
def nested(body: NestedRequest):
    return {"ok": True}  # pragma: no cover


@app.post("/simple")
def simple(body: SimpleRequest):
    return {"ok": True}  # pragma: no cover


@debug_app.post("/simple")
def debug_simple(body: SimpleRequest):
    return {"ok": True}  # pragma: no cover


@debug_app.post("/login")
def debug_login(body: LoginRequest):
    return {"ok": True}  # pragma: no cover


@debug_app.post("/nested")
def debug_nested(body: NestedRequest):
    return {"ok": True}  # pragma: no cover


client = TestClient(app)
debug_client = TestClient(debug_app)


def test_non_debug_mode_excludes_body():
    """Non-debug mode responses should NOT include the body field."""
    # Missing field 'age' triggers validation error
    response = client.post("/simple", json={"name": "Alice"})
    assert response.status_code == 422
    data = response.json()
    assert "path" in data
    assert "method" in data
    assert "body" not in data


def test_non_debug_mode_includes_path_and_method():
    """Validation error responses include request path and HTTP method."""
    response = client.post("/simple", json={"name": "Alice"})
    assert response.status_code == 422
    data = response.json()
    assert data["path"] == "/simple"
    assert data["method"] == "POST"


def test_debug_mode_includes_body():
    """In debug mode, the received body is included in the error response."""
    # Missing field 'age' triggers validation error
    response = debug_client.post("/simple", json={"name": "Alice"})
    assert response.status_code == 422
    data = response.json()
    assert "body" in data
    assert data["body"] == {"name": "Alice"}


def test_sensitive_field_redaction_simple():
    """Fields named password are replaced with ***REDACTED***."""
    # Missing field 'password' - but we need a body with password in it
    # Send a body that has a password but is missing 'username'
    response = debug_client.post("/login", json={"password": "secret123"})
    assert response.status_code == 422
    data = response.json()
    assert "body" in data
    assert data["body"]["password"] == "***REDACTED***"


def test_sensitive_field_redaction_nested():
    """Redaction works for nested objects containing sensitive field names."""
    # Missing top-level 'user' field - send body with nested password and token
    response = debug_client.post(
        "/nested",
        json={"user": {"username": "alice", "password": "hunter2"}, "token": "abc123"},
    )
    # All required fields present - validate succeeds, so this won't trigger 422
    # Need to send body that triggers validation error but has password in it
    # Send body with nested redactable fields but missing a required field at top level
    response = debug_client.post(
        "/nested",
        json={"user": {"username": "alice", "password": "hunter2"}},
    )
    assert response.status_code == 422
    data = response.json()
    assert data["body"]["user"]["password"] == "***REDACTED***"
    assert data["body"]["user"]["username"] == "alice"


def test_debug_mode_path_and_method():
    """Debug mode responses also include path and method."""
    response = debug_client.post("/login", json={"username": "alice"})
    assert response.status_code == 422
    data = response.json()
    assert data["path"] == "/login"
    assert data["method"] == "POST"
    assert "body" in data
    assert data["body"] == {"username": "alice"}


def test_sensitive_field_redaction_token():
    """Fields named token are replaced with ***REDACTED***."""
    response = debug_client.post("/simple", json={"name": "test", "token": "s3cret"})
    assert response.status_code == 422
    data = response.json()
    assert "body" in data
    assert data["body"]["token"] == "***REDACTED***"
    assert data["body"]["name"] == "test"