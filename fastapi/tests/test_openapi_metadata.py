from fastapi import FastAPI
from fastapi.testclient import TestClient
from inline_snapshot import snapshot

app = FastAPI(
    servers=[
        {"url": "https://api.example.com/v1", "description": "Production server"},
        {"url": "https://staging.example.com/v1", "description": "Staging server"},
    ],
    contact={
        "name": "API Support",
        "url": "https://example.com/support",
        "email": "support@example.com",
    },
    license_info={
        "name": "Apache 2.0",
        "url": "https://www.apache.org/licenses/LICENSE-2.0.html",
    },
)


@app.get("/items")
def read_items():
    return [{"id": 1, "name": "Foo"}]


client = TestClient(app)


def test_app():
    response = client.get("/items")
    assert response.status_code == 200, response.text


def test_openapi_schema_has_servers():
    response = client.get("/openapi.json")
    assert response.status_code == 200, response.text
    data = response.json()
    assert "servers" in data
    servers = data["servers"]
    assert len(servers) == 2
    assert servers[0] == {
        "url": "https://api.example.com/v1",
        "description": "Production server",
    }
    assert servers[1] == {
        "url": "https://staging.example.com/v1",
        "description": "Staging server",
    }


def test_openapi_schema_has_contact():
    response = client.get("/openapi.json")
    assert response.status_code == 200, response.text
    data = response.json()
    info = data["info"]
    assert "contact" in info
    assert info["contact"] == {
        "name": "API Support",
        "url": "https://example.com/support",
        "email": "support@example.com",
    }


def test_openapi_schema_has_license():
    response = client.get("/openapi.json")
    assert response.status_code == 200, response.text
    data = response.json()
    info = data["info"]
    assert "license" in info
    assert info["license"] == {
        "name": "Apache 2.0",
        "url": "https://www.apache.org/licenses/LICENSE-2.0.html",
    }