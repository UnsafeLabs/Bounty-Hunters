from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel


class Item(BaseModel):
    name: str
    count: int


def create_app(*, debug: bool) -> FastAPI:
    app = FastAPI(debug=debug)

    @app.post("/items/{item_id}")
    async def create_item(item_id: int, item: Item):
        return {"item_id": item_id, "item": item}

    return app


def invalid_body() -> dict[str, object]:
    return {
        "name": "Widget",
        "count": "not-an-int",
        "password": "plain-password",
        "nested": {
            "secret": "nested-secret",
            "visible": "kept",
            "items": [
                {"token": "nested-token"},
                {"api_key": "nested-api-key", "value": 1},
            ],
        },
    }


def test_validation_error_includes_request_path_and_method_without_debug_body():
    response = TestClient(create_app(debug=False)).post(
        "/items/10", json=invalid_body()
    )

    assert response.status_code == 422
    content = response.json()
    assert content["path"] == "/items/10"
    assert content["method"] == "POST"
    assert "detail" in content
    assert "body" not in content


def test_validation_error_debug_body_redacts_sensitive_fields():
    response = TestClient(create_app(debug=True)).post("/items/10", json=invalid_body())

    assert response.status_code == 422
    content = response.json()
    assert content["path"] == "/items/10"
    assert content["method"] == "POST"
    assert content["body"] == {
        "name": "Widget",
        "count": "not-an-int",
        "password": "***REDACTED***",
        "nested": {
            "secret": "***REDACTED***",
            "visible": "kept",
            "items": [
                {"token": "***REDACTED***"},
                {"api_key": "***REDACTED***", "value": 1},
            ],
        },
    }
