import base64

import pytest
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.requests import Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from starlette.applications import Starlette


def test_exception_handler_includes_path_and_method():
    """Validation error responses include request path and HTTP method."""
    app = FastAPI()

    @app.get("/items/{item_id}")
    def read_item(item_id: int):
        pass  # pragma: no cover

    client = TestClient(app)
    response = client.get("/items/invalid")
    assert response.status_code == 422
    data = response.json()
    assert "path" in data
    assert data["path"] == "/items/invalid"
    assert "method" in data
    assert data["method"] == "GET"


def test_exception_handler_debug_mode_includes_body():
    """In debug mode, the received body is included in the error response."""
    app = FastAPI(debug=True)

    @app.post("/items/")
    def create_item(name: str, price: float):
        pass  # pragma: no cover

    client = TestClient(app)
    response = client.post("/items/", json={"name": "test", "price": "not_a_number"})
    assert response.status_code == 422
    data = response.json()
    assert "body" in data
    assert data["body"] == {"name": "test", "price": "not_a_number"}
    assert data["path"] == "/items/"
    assert data["method"] == "POST"


def test_exception_handler_non_debug_excludes_body():
    """Non-debug mode responses do not include the body."""
    app = FastAPI(debug=False)

    @app.post("/items/")
    def create_item(name: str, price: float):
        pass  # pragma: no cover

    client = TestClient(app)
    response = client.post("/items/", json={"name": "test", "price": "not_a_number"})
    assert response.status_code == 422
    data = response.json()
    assert "body" not in data


def test_redaction_of_sensitive_fields_in_body():
    """Fields named password, secret, token, or api_key are replaced with ***REDACTED***."""
    app = FastAPI(debug=True)

    @app.post("/login/")
    def login(username: str, password: str):
        pass  # pragma: no cover

    client = TestClient(app)
    response = client.post(
        "/login/",
        json={"username": "admin", "password": "supersecret"},
    )
    assert response.status_code == 422
    data = response.json()
    assert data["body"]["username"] == "admin"
    assert data["body"]["password"] == "***REDACTED***"


def test_redaction_in_nested_objects():
    """Sensitive field redaction works for nested objects."""
    app = FastAPI(debug=True)

    @app.post("/config/")
    def set_config(config: dict):
        pass  # pragma: no cover

    client = TestClient(app)
    response = client.post(
        "/config/",
        json={
            "app_name": "myapp",
            "database": {"password": "db_pass_123", "host": "localhost"},
            "credentials": {"api_key": "abc123", "secret": "my_secret"},
        },
    )
    assert response.status_code == 422
    body = response.json()["body"]
    assert body["database"]["password"] == "***REDACTED***"
    assert body["app_name"] == "myapp"
    assert body["credentials"]["api_key"] == "***REDACTED***"
    assert body["credentials"]["secret"] == "***REDACTED***"
    assert body["database"]["host"] == "localhost"