"""Tests for validation error request context + sensitive body redaction."""

from typing import Optional

from fastapi import FastAPI
from fastapi.exception_handlers import redact_sensitive_fields
from fastapi.testclient import TestClient
from pydantic import BaseModel


class LoginBody(BaseModel):
    username: str
    password: str
    token: Optional[str] = None


class NestedSecrets(BaseModel):
    name: str
    credentials: dict


def test_redact_sensitive_fields_nested():
    payload = {
        "username": "alice",
        "password": "s3cret",
        "nested": {
            "api_key": "abc123",
            "token": "tok",
            "ok": True,
            "list": [{"secret": "x"}, {"value": 1}],
        },
    }
    redacted = redact_sensitive_fields(payload)
    assert redacted["username"] == "alice"
    assert redacted["password"] == "***REDACTED***"
    assert redacted["nested"]["api_key"] == "***REDACTED***"
    assert redacted["nested"]["token"] == "***REDACTED***"
    assert redacted["nested"]["ok"] is True
    assert redacted["nested"]["list"][0]["secret"] == "***REDACTED***"
    assert redacted["nested"]["list"][1]["value"] == 1


def test_validation_error_includes_path_and_method_non_debug():
    app = FastAPI(debug=False)

    @app.post("/login")
    def login(body: LoginBody):
        return body

    client = TestClient(app)
    response = client.post("/login", json={"username": "alice"})
    assert response.status_code == 422
    data = response.json()
    assert "detail" in data
    assert data["path"] == "/login"
    assert data["method"] == "POST"
    assert "body" not in data


def test_validation_error_includes_redacted_body_in_debug():
    app = FastAPI(debug=True)

    @app.post("/login")
    def login(body: LoginBody):
        return body

    client = TestClient(app)
    response = client.post(
        "/login",
        json={"username": "alice", "password": "hunter2", "token": "t"},
    )
    # password + token present but username valid; still may pass validation
    # Force validation failure by omitting username type
    response = client.post(
        "/login",
        json={"username": 123, "password": "hunter2", "token": "t"},
    )
    assert response.status_code == 422
    data = response.json()
    assert data["path"] == "/login"
    assert data["method"] == "POST"
    assert "body" in data
    assert data["body"]["username"] == 123
    assert data["body"]["password"] == "***REDACTED***"
    assert data["body"]["token"] == "***REDACTED***"


def test_validation_error_redacts_nested_sensitive_keys_in_debug():
    app = FastAPI(debug=True)

    @app.post("/nested")
    def nested(body: NestedSecrets):
        return body

    client = TestClient(app)
    # missing required `name` forces validation error while credentials present
    response = client.post(
        "/nested",
        json={
            "credentials": {
                "api_key": "k",
                "password": "p",
                "secret": "s",
                "token": "t",
                "public": "ok",
            }
        },
    )
    assert response.status_code == 422
    data = response.json()
    assert data["path"] == "/nested"
    assert data["method"] == "POST"
    body = data["body"]
    creds = body["credentials"]
    assert creds["api_key"] == "***REDACTED***"
    assert creds["password"] == "***REDACTED***"
    assert creds["secret"] == "***REDACTED***"
    assert creds["token"] == "***REDACTED***"
    assert creds["public"] == "ok"


def test_non_debug_never_includes_body_even_with_sensitive_payload():
    app = FastAPI(debug=False)

    @app.post("/login")
    def login(body: LoginBody):
        return body

    client = TestClient(app)
    response = client.post(
        "/login",
        json={"username": 1, "password": "x", "token": "y", "api_key": "z"},
    )
    assert response.status_code == 422
    data = response.json()
    assert data["path"] == "/login"
    assert data["method"] == "POST"
    assert "body" not in data
