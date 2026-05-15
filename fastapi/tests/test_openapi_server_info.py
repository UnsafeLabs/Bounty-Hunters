from fastapi import FastAPI
from fastapi.testclient import TestClient


def test_openapi_includes_servers():
    app = FastAPI(
        servers=[
            {"url": "https://api.example.com", "description": "Production"},
            {"url": "https://staging.example.com", "description": "Staging"},
        ]
    )

    @app.get("/")
    def root():
        return {"ok": True}

    client = TestClient(app)
    response = client.get("/openapi.json")
    schema = response.json()
    assert "servers" in schema
    assert len(schema["servers"]) == 2
    assert schema["servers"][0]["url"] == "https://api.example.com"
    assert schema["servers"][0]["description"] == "Production"


def test_openapi_includes_contact():
    app = FastAPI(
        contact={"name": "API Support", "url": "https://example.com/support", "email": "support@example.com"}
    )

    @app.get("/")
    def root():
        return {"ok": True}

    client = TestClient(app)
    response = client.get("/openapi.json")
    schema = response.json()
    assert "contact" in schema["info"]
    assert schema["info"]["contact"]["name"] == "API Support"
    assert schema["info"]["contact"]["email"] == "support@example.com"


def test_openapi_includes_license():
    app = FastAPI(
        license_info={"name": "MIT", "url": "https://opensource.org/licenses/MIT"}
    )

    @app.get("/")
    def root():
        return {"ok": True}

    client = TestClient(app)
    response = client.get("/openapi.json")
    schema = response.json()
    assert "license" in schema["info"]
    assert schema["info"]["license"]["name"] == "MIT"
    assert schema["info"]["license"]["url"] == "https://opensource.org/licenses/MIT"


def test_openapi_without_optional_fields():
    app = FastAPI()

    @app.get("/")
    def root():
        return {"ok": True}

    client = TestClient(app)
    response = client.get("/openapi.json")
    schema = response.json()
    assert "servers" not in schema or schema.get("servers") is None
    assert "contact" not in schema["info"]
    assert "license" not in schema["info"]


def test_openapi_all_fields_together():
    app = FastAPI(
        title="Test API",
        version="1.0.0",
        servers=[{"url": "https://api.test.com"}],
        contact={"name": "Dev", "email": "dev@test.com"},
        license_info={"name": "Apache 2.0"},
    )

    @app.get("/")
    def root():
        return {"ok": True}

    client = TestClient(app)
    schema = client.get("/openapi.json").json()
    assert schema["info"]["title"] == "Test API"
    assert schema["info"]["version"] == "1.0.0"
    assert schema["servers"][0]["url"] == "https://api.test.com"
    assert schema["info"]["contact"]["name"] == "Dev"
    assert schema["info"]["license"]["name"] == "Apache 2.0"
