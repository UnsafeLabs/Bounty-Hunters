import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.requests import Request


def test_validation_error_includes_path_and_method():
    app = FastAPI(debug=False)

    @app.get("/items/{item_id}")
    async def get_item(item_id: int):
        return {"item_id": item_id}  # pragma: no cover

    client = TestClient(app)
    response = client.get("/items/invalid")
    assert response.status_code == 422
    data = response.json()
    assert data["path"] == "/items/invalid"
    assert data["method"] == "GET"
    assert "body" not in data


def test_validation_error_includes_body_in_debug_mode():
    app = FastAPI(debug=True)

    @app.post("/items")
    async def create_item(name: str, price: float):
        return {"name": name, "price": price}  # pragma: no cover

    client = TestClient(app)
    response = client.post("/items", json={"price": "not-a-number"})
    assert response.status_code == 422
    data = response.json()
    assert data["path"] == "/items"
    assert data["method"] == "POST"
    assert data["body"] == {"price": "not-a-number"}


def test_validation_error_redacts_sensitive_fields():
    app = FastAPI(debug=True)

    @app.post("/login")
    async def login(username: str, password: str):
        return {"ok": True}  # pragma: no cover

    client = TestClient(app)
    response = client.post("/login", json={"username": "admin", "password": "secret123"})
    assert response.status_code == 422
    data = response.json()
    assert data["body"]["username"] == "admin"
    assert data["body"]["password"] == "***REDACTED***"


def test_validation_error_redacts_sensitive_fields_nested():
    app = FastAPI(debug=True)

    @app.post("/config")
    async def update_config(api_key: str, host: str, port: int):
        return {"ok": True}  # pragma: no cover

    client = TestClient(app)
    response = client.post("/config", json={"api_key": "sk-1234567890abcdef", "host": "localhost", "port": "invalid"})
    assert response.status_code == 422
    data = response.json()
    assert data["body"]["api_key"] == "***REDACTED***"
    assert data["body"]["host"] == "localhost"


@pytest.mark.parametrize("sensitive_field", ["password", "secret", "token", "api_key"])
def test_all_sensitive_fields_redacted(sensitive_field):
    app = FastAPI(debug=True)

    @app.post("/test")
    async def test_endpoint(x: int):
        return {"x": x}  # pragma: no cover

    client = TestClient(app)
    body = {sensitive_field: "value123", "other": "keep"}
    response = client.post("/test", json=body)
    assert response.status_code == 422
    data = response.json()
    assert data["body"][sensitive_field] == "***REDACTED***"
    assert data["body"]["other"] == "keep"