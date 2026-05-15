"""Tests for the request validation exception handler with body/path info."""

import json

import pytest
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from pydantic import BaseModel


def test_validation_error_includes_path_and_method():
    """Validation error responses include request path and HTTP method."""
    app = FastAPI()

    @app.post("/items/{item_id}")
    async def create_item(item_id: int, item: dict):  # type: ignore[return]
        ...

    client = TestClient(app, raise_server_exceptions=False)

    # Trigger a validation error by passing a non-integer path param
    response = client.post("/items/abc")
    data = response.json()
    assert response.status_code == 422
    assert data["path"] == "/items/abc"
    assert data["method"] == "POST"


def test_validation_error_includes_body_in_debug_mode():
    """In debug mode, the received body is included in the error response."""
    app = FastAPI(debug=True)

    @app.post("/submit")
    async def submit(data: dict):
        ...

    client = TestClient(app, raise_server_exceptions=False)

    # Send a valid JSON body that should trigger a different validation error
    # (e.g., the route expects a dict but we send something unexpected for schema)
    response = client.post("/submit", json={"field": "value"})
    data = response.json()
    assert response.status_code == 422
    assert "body" in data


def test_validation_error_no_body_in_non_debug_mode():
    """Non-debug mode responses do not include the body."""
    app = FastAPI(debug=False)

    @app.post("/items/{item_id}")
    async def create_item(item_id: int, item: dict):
        ...

    client = TestClient(app, raise_server_exceptions=False)

    response = client.post("/items/abc")
    data = response.json()
    assert response.status_code == 422
    assert "body" not in data
    assert data["path"] == "/items/abc"
    assert data["method"] == "POST"


def test_sensitive_fields_redacted_in_debug_mode():
    """Fields named 'password', 'secret', 'token', or 'api_key' are replaced with '***REDACTED***'."""
    app = FastAPI(debug=True)

    @app.post("/login")
    async def login(data: dict):
        ...

    client = TestClient(app, raise_server_exceptions=False)

    response = client.post(
        "/login",
        json={"username": "admin", "password": "supersecret", "token": "abc123"},
    )
    data = response.json()
    assert data["body"]["password"] == "***REDACTED***"
    assert data["body"]["token"] == "***REDACTED***"
    assert data["body"]["username"] == "admin"


def test_sensitive_fields_redacted_nested():
    """Sensitive fields in nested objects are also redacted."""
    app = FastAPI(debug=True)

    @app.post("/config")
    async def config(data: dict):
        ...

    client = TestClient(app, raise_server_exceptions=False)

    response = client.post(
        "/config",
        json={
            "user": {
                "name": "test",
                "password": "hunter2",
                "api_key": "sk-12345",
            },
            "settings": {"theme": "dark", "secret": "my_private_key"},
        },
    )
    data = response.json()
    assert data["body"]["user"]["password"] == "***REDACTED***"
    assert data["body"]["user"]["api_key"] == "***REDACTED***"
    assert data["body"]["user"]["name"] == "test"
    assert data["body"]["settings"]["secret"] == "***REDACTED***"
    assert data["body"]["settings"]["theme"] == "dark"