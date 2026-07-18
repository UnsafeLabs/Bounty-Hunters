from fastapi import FastAPI
from fastapi.testclient import TestClient
from inline_snapshot import snapshot


app = FastAPI(
    title="Test API",
    version="2.0.0",
    contact={
        "name": "API Support",
        "url": "https://example.com/contact",
        "email": "support@example.com",
    },
    license_info={
        "name": "MIT",
        "url": "https://opensource.org/licenses/MIT",
    },
    servers=[
        {"url": "https://api.example.com/v1", "description": "Production"},
    ],
)


@app.get("/items")
def read_items():
    return [{"id": 1, "name": "Item"}]


client = TestClient(app)


def test_app():
    response = client.get("/items")
    assert response.status_code == 200, response.text


def test_openapi_schema():
    response = client.get("/openapi.json")
    assert response.status_code == 200, response.text
    assert response.json() == snapshot(
        {
            "openapi": "3.1.0",
            "info": {
                "title": "Test API",
                "version": "2.0.0",
                "contact": {
                    "name": "API Support",
                    "url": "https://example.com/contact",
                    "email": "support@example.com",
                },
                "license": {
                    "name": "MIT",
                    "url": "https://opensource.org/licenses/MIT",
                },
            },
            "servers": [
                {"url": "https://api.example.com/v1", "description": "Production"},
            ],
            "paths": {
                "/items": {
                    "get": {
                        "summary": "Read Items",
                        "operationId": "read_items_items_get",
                        "responses": {
                            "200": {
                                "description": "Successful Response",
                                "content": {"application/json": {"schema": {}}},
                            }
                        },
                    }
                }
            },
        }
    )


def test_openapi_schema_without_optional():
    app_no_meta = FastAPI()

    @app_no_meta.get("/foo")
    def foo():
        return {"ok": True}

    client_no_meta = TestClient(app_no_meta)
    response = client_no_meta.get("/openapi.json")
    assert response.status_code == 200, response.text
    data = response.json()
    assert "servers" not in data
    assert "contact" not in data.get("info", {})
    assert "license" not in data.get("info", {})
