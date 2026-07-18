from fastapi import FastAPI
from fastapi.testclient import TestClient


app = FastAPI()


@app.post("/items/{item_id}")
async def create_item(item_id: int, item: dict):
    return {"item_id": item_id, "item": item}


client = TestClient(app)


def test_validation_error_includes_path_and_method():
    response = client.post("/items/abc", json={"name": "test"})
    assert response.status_code == 422
    data = response.json()
    assert data["path"] == "/items/abc"
    assert data["method"] == "POST"
    assert "detail" in data


def test_validation_error_no_body_in_non_debug():
    response = client.post("/items/abc", json={"name": "test"})
    assert response.status_code == 422
    data = response.json()
    assert "body" not in data


def test_validation_error_body_in_debug_mode():
    app_debug = FastAPI(debug=True)

    @app_debug.post("/users/{user_id}")
    async def create_user(user_id: int, user: dict):
        return {"user_id": user_id, "user": user}

    client_debug = TestClient(app_debug)
    response = client_debug.post("/users/abc", json={"name": "Alice", "age": 30})
    assert response.status_code == 422
    data = response.json()
    assert data["path"] == "/users/abc"
    assert data["method"] == "POST"
    assert "body" in data
    assert data["body"] == {"name": "Alice", "age": 30}


def test_validation_error_redacts_sensitive_fields():
    app_debug = FastAPI(debug=True)

    @app_debug.post("/login")
    async def login(data: dict):
        return {"ok": True}

    client_debug = TestClient(app_debug)
    response = client_debug.post(
        "/login",
        json={"username": "alice", "password": "supersecret", "token": "abc123"},
    )
    assert response.status_code == 422
    data = response.json()
    assert "body" in data
    assert data["body"]["password"] == "***REDACTED***"
    assert data["body"]["token"] == "***REDACTED***"
    assert data["body"]["username"] == "alice"


def test_validation_error_redacts_nested_sensitive_fields():
    app_debug = FastAPI(debug=True)

    @app_debug.post("/config")
    async def config(data: dict):
        return {"ok": True}

    client_debug = TestClient(app_debug)
    response = client_debug.post(
        "/config",
        json={
            "app": {"api_key": "sk-123456", "name": "myapp"},
            "user": {"token": "xyz789", "email": "test@test.com"},
        },
    )
    assert response.status_code == 422
    data = response.json()
    assert "body" in data
    assert data["body"]["app"]["api_key"] == "***REDACTED***"
    assert data["body"]["app"]["name"] == "myapp"
    assert data["body"]["user"]["token"] == "***REDACTED***"
    assert data["body"]["user"]["email"] == "test@test.com"
