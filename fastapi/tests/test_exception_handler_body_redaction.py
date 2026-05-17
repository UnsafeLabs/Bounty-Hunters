from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel


class Item(BaseModel):
    name: str
    price: float
    password: str


app = FastAPI(debug=True)
non_debug_app = FastAPI(debug=False)


@app.post("/items/")
def create_item(item: Item):
    return {"item": item.model_dump()}  # pragma: no cover


@non_debug_app.post("/items/")
def create_item_non_debug(item: Item):
    return {"item": item.model_dump()}  # pragma: no cover


client = TestClient(app)
non_debug_client = TestClient(non_debug_app)


def test_validation_error_response_includes_path_and_method():
    response = client.post("/items/", json={"name": "test", "price": "not-a-number"})
    assert response.status_code == 422
    data = response.json()
    assert data["path"] == "/items/"
    assert data["method"] == "POST"
    assert "detail" in data


def test_debug_mode_validation_response_includes_body():
    response = client.post(
        "/items/", json={"name": "test", "price": "not-a-number"}
    )
    assert response.status_code == 422
    data = response.json()
    assert "body" in data
    assert data["body"]["name"] == "test"
    assert data["body"]["price"] == "not-a-number"


def test_debug_mode_redacts_sensitive_fields_in_body():
    response = client.post(
        "/items/",
        json={
            "name": "test",
            "price": "not-a-number",
            "password": "supersecret",
        },
    )
    assert response.status_code == 422
    data = response.json()
    assert data["body"]["name"] == "test"
    assert data["body"]["price"] == "not-a-number"
    assert data["body"]["password"] == "***REDACTED***"


def test_debug_mode_redacts_nested_sensitive_fields():
    response = client.post(
        "/items/",
        json={
            "name": "test",
            "price": "not-a-number",
            "password": "supersecret",
            "metadata": {
                "token": "abc123",
                "api_key": "key_xyz",
                "safe_field": "hello",
            },
        },
    )
    assert response.status_code == 422
    data = response.json()
    assert data["body"]["password"] == "***REDACTED***"
    assert data["body"]["metadata"]["token"] == "***REDACTED***"
    assert data["body"]["metadata"]["api_key"] == "***REDACTED***"
    assert data["body"]["metadata"]["safe_field"] == "hello"


def test_non_debug_mode_excludes_body():
    response = non_debug_client.post(
        "/items/", json={"name": "test", "price": "not-a-number"}
    )
    assert response.status_code == 422
    data = response.json()
    assert "body" not in data
    assert data["path"] == "/items/"
    assert data["method"] == "POST"


def test_debug_mode_handles_empty_body():
    response = client.post("/items/", json={})
    assert response.status_code == 422
    data = response.json()
    assert data["path"] == "/items/"
    assert data["method"] == "POST"