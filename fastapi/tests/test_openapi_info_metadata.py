from fastapi.openapi.utils import get_openapi


def test_get_openapi_without_optional_info_metadata():
    schema = get_openapi(title="FastAPI", version="0.1.0", routes=[])

    assert schema == {
        "openapi": "3.1.0",
        "info": {"title": "FastAPI", "version": "0.1.0"},
        "paths": {},
    }


def test_get_openapi_includes_servers():
    servers = [
        {"url": "https://staging.example.com", "description": "Staging"},
        {"url": "https://api.example.com", "description": "Production"},
    ]

    schema = get_openapi(
        title="FastAPI",
        version="0.1.0",
        routes=[],
        servers=servers,
    )

    assert schema["servers"] == servers


def test_get_openapi_includes_contact():
    contact = {
        "name": "API Support",
        "url": "https://example.com/support",
        "email": "support@example.com",
    }

    schema = get_openapi(
        title="FastAPI",
        version="0.1.0",
        routes=[],
        contact=contact,
    )

    assert schema["info"]["contact"] == contact


def test_get_openapi_includes_license_info():
    license_info = {
        "name": "Apache 2.0",
        "url": "https://www.apache.org/licenses/LICENSE-2.0.html",
    }

    schema = get_openapi(
        title="FastAPI",
        version="0.1.0",
        routes=[],
        license_info=license_info,
    )

    assert schema["info"]["license"] == license_info


def test_get_openapi_includes_all_optional_info_metadata():
    servers = [{"url": "https://api.example.com", "description": "Production"}]
    contact = {"name": "API Support", "email": "support@example.com"}
    license_info = {"name": "MIT", "url": "https://opensource.org/licenses/MIT"}

    schema = get_openapi(
        title="FastAPI",
        version="0.1.0",
        routes=[],
        servers=servers,
        contact=contact,
        license_info=license_info,
    )

    assert schema["servers"] == servers
    assert schema["info"]["contact"] == contact
    assert schema["info"]["license"] == license_info
