from fastapi import FastAPI
from fastapi.testclient import TestClient


def test_openapi_servers():
    app = FastAPI(servers=[{"url": "https://api.example.com", "description": "Production"}])

    @app.get("/")
    async def root():
        return {"msg": "ok"}

    schema = app.openapi()
    assert "servers" in schema
    assert schema["servers"] == [{"url": "https://api.example.com", "description": "Production"}]


def test_openapi_contact():
    app = FastAPI(contact={"name": "Support", "email": "support@example.com"})

    @app.get("/")
    async def root():
        return {"msg": "ok"}

    schema = app.openapi()
    assert "info" in schema
    assert schema["info"]["contact"] == {"name": "Support", "email": "support@example.com"}


def test_openapi_license():
    app = FastAPI(license_info={"name": "MIT", "url": "https://opensource.org/licenses/MIT"})

    @app.get("/")
    async def root():
        return {"msg": "ok"}

    schema = app.openapi()
    assert "info" in schema
    assert schema["info"]["license"] == {"name": "MIT", "url": "https://opensource.org/licenses/MIT"}


def test_openapi_all_metadata():
    app = FastAPI(
        servers=[{"url": "https://api.example.com"}],
        contact={"name": "API Team", "email": "team@example.com"},
        license_info={"name": "Apache 2.0"},
    )

    @app.get("/")
    async def root():
        return {"msg": "ok"}

    schema = app.openapi()
    assert schema["servers"] == [{"url": "https://api.example.com"}]
    assert schema["info"]["contact"] == {"name": "API Team", "email": "team@example.com"}
    assert schema["info"]["license"] == {"name": "Apache 2.0"}


def test_openapi_no_metadata():
    app = FastAPI()

    @app.get("/")
    async def root():
        return {"msg": "ok"}

    schema = app.openapi()
    assert "servers" not in schema
    assert "contact" not in schema.get("info", {})
    assert "license" not in schema.get("info", {})
