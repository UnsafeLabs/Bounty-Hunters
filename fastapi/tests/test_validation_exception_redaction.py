from typing import List, Optional
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel


class NestedModel(BaseModel):
    name: str
    password: str
    secret: Optional[str] = None


class PayloadModel(BaseModel):
    username: str
    password: str
    api_key: str
    token: str
    nested: NestedModel
    deep_nested: List[NestedModel]


def get_app(debug: bool) -> FastAPI:
    app = FastAPI(debug=debug)

    @app.post("/items")
    def create_item(item: PayloadModel):
        return {"status": "ok"}

    return app


def test_validation_error_with_debug():
    app = get_app(debug=True)
    client = TestClient(app)

    payload = {
        # Missing required field "username" to trigger RequestValidationError
        "password": "my_password",
        "api_key": "my_api_key",
        "token": "my_token",
        "nested": {
            "name": "john",
            "password": "nested_password",
            "secret": "nested_secret",
        },
        "deep_nested": [
            {
                "name": "jane",
                "password": "deep_password_1",
                "secret": "deep_secret_1",
            }
        ],
    }

    response = client.post("/items", json=payload)
    assert response.status_code == 422

    data = response.json()
    assert data["path"] == "/items"
    assert data["method"] == "POST"
    assert "detail" in data
    assert "body" in data

    body = data["body"]
    assert body["password"] == "***REDACTED***"
    assert body["api_key"] == "***REDACTED***"
    assert body["token"] == "***REDACTED***"
    
    assert body["nested"]["name"] == "john"
    assert body["nested"]["password"] == "***REDACTED***"
    assert body["nested"]["secret"] == "***REDACTED***"

    assert body["deep_nested"][0]["name"] == "jane"
    assert body["deep_nested"][0]["password"] == "***REDACTED***"
    assert body["deep_nested"][0]["secret"] == "***REDACTED***"


def test_validation_error_without_debug():
    app = get_app(debug=False)
    client = TestClient(app)

    payload = {
        "password": "my_password",
        "api_key": "my_api_key",
        "token": "my_token",
        "nested": {
            "name": "john",
            "password": "nested_password",
            "secret": "nested_secret",
        },
        "deep_nested": [],
    }

    response = client.post("/items", json=payload)
    assert response.status_code == 422

    data = response.json()
    assert data["path"] == "/items"
    assert data["method"] == "POST"
    assert "detail" in data
    assert "body" not in data
