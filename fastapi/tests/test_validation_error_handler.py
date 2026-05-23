from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel


class Item(BaseModel):
    name: str
    price: float


class Login(BaseModel):
    username: str
    password: str


def test_includes_path_and_method():
    app = FastAPI()

    @app.post("/items/")
    async def create(item: Item):
        return item

    client = TestClient(app)
    resp = client.post("/items/", json={"name": "test"})
    assert resp.status_code == 422
    data = resp.json()
    assert data["path"] == "/items/"
    assert data["method"] == "POST"


def test_includes_body_in_debug_mode():
    app = FastAPI(debug=True)

    @app.post("/items/")
    async def create(item: Item):
        return item

    client = TestClient(app)
    resp = client.post("/items/", json={"name": "test"})
    assert resp.status_code == 422
    data = resp.json()
    assert "body" in data
    assert data["body"] == {"name": "test"}


def test_body_omitted_in_non_debug_mode():
    app = FastAPI(debug=False)

    @app.post("/items/")
    async def create(item: Item):
        return item

    client = TestClient(app)
    resp = client.post("/items/", json={"name": "test"})
    assert resp.status_code == 422
    data = resp.json()
    assert "body" not in data


def test_password_redacted_in_body():
    app = FastAPI(debug=True)

    @app.post("/login/")
    async def login(item: Item):
        return item

    client = TestClient(app)
    # Include password in the body but trigger validation error by omitting price
    resp = client.post(
        "/login/",
        json={"name": "admin", "password": "supersecret"},
    )
    data = resp.json()
    assert data["body"]["password"] == "***REDACTED***"
    assert data["body"]["name"] == "admin"


def test_nested_sensitive_fields_redacted():
    app = FastAPI(debug=True)

    @app.post("/config/")
    async def config(item: Item):
        return item

    client = TestClient(app)
    resp = client.post(
        "/config/",
        json={
            "name": "test",
            "credentials": {"secret": "shh", "token": "xyz", "label": "ok"},
        },
    )
    data = resp.json()
    assert data["body"]["credentials"]["secret"] == "***REDACTED***"
    assert data["body"]["credentials"]["token"] == "***REDACTED***"
    assert data["body"]["credentials"]["label"] == "ok"
