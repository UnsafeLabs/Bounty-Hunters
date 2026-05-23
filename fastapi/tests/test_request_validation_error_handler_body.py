from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel


class NestedPayload(BaseModel):
    password: str
    name: str


class Payload(BaseModel):
    count: int
    password: str
    secret: str
    token: str
    api_key: str
    nested: NestedPayload


def create_app(*, debug: bool) -> FastAPI:
    app = FastAPI(debug=debug)

    @app.post("/items/{item_id}")
    def create_item(item_id: int, payload: Payload):
        return {"item_id": item_id, "payload": payload}  # pragma: no cover

    return app


def test_validation_error_includes_path_and_method_without_body_by_default():
    client = TestClient(create_app(debug=False))

    response = client.post("/items/123", json={"count": "not-an-int"})

    assert response.status_code == 422
    content = response.json()
    assert content["path"] == "/items/123"
    assert content["method"] == "POST"
    assert "detail" in content
    assert "body" not in content


def test_validation_error_includes_redacted_body_in_debug_mode():
    client = TestClient(create_app(debug=True))
    request_body = {
        "count": "not-an-int",
        "password": "plain-password",
        "secret": "plain-secret",
        "token": "plain-token",
        "api_key": "plain-api-key",
        "nested": {"password": "nested-password", "name": "visible"},
    }

    response = client.post("/items/123", json=request_body)

    assert response.status_code == 422
    content = response.json()
    assert content["path"] == "/items/123"
    assert content["method"] == "POST"
    assert content["body"] == {
        "count": "not-an-int",
        "password": "***REDACTED***",
        "secret": "***REDACTED***",
        "token": "***REDACTED***",
        "api_key": "***REDACTED***",
        "nested": {"password": "***REDACTED***", "name": "visible"},
    }
