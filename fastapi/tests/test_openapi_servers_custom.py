from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi
from fastapi.testclient import TestClient

app = FastAPI()


@app.get("/items/")
def read_items():
    return [{"name": "Foo"}]


def test_get_openapi_with_servers_contact_license():
    servers = [{"url": "https://api.example.com", "description": "Production"}]
    contact = {"name": "API Support", "url": "https://example.com/support", "email": "support@example.com"}
    license_info = {"name": "Apache 2.0", "url": "https://www.apache.org/licenses/LICENSE-2.0.html"}

    schema = get_openapi(
        title="Custom OpenAPI",
        version="1.0.0",
        routes=app.routes,
        servers=servers,
        contact=contact,
        license_info=license_info,
    )

    assert schema["servers"] == servers
    assert schema["info"]["contact"] == contact
    assert schema["info"]["license"] == license_info


def test_get_openapi_without_optional_parameters():
    schema = get_openapi(
        title="Minimal OpenAPI",
        version="1.0.0",
        routes=app.routes,
    )

    assert "servers" not in schema
    assert "contact" not in schema["info"]
    assert "license" not in schema["info"]
