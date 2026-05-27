from fastapi import FastAPI
from fastapi.testclient import TestClient

app = FastAPI(
    swagger_js_url="https://example.com/swagger-ui-bundle.js",
    swagger_css_url="https://example.com/swagger-ui.css",
    swagger_favicon_url="https://example.com/favicon.png",
    redoc_js_url="https://example.com/redoc.standalone.js",
    redoc_favicon_url="https://example.com/favicon.png",
    with_google_fonts=False,
)


@app.get("/items/")
async def read_items():
    return {"id": "foo"}


client = TestClient(app)


def test_swagger_ui_with_custom_cdn_urls():
    response = client.get("/docs")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "text/html; charset=utf-8"
    assert "https://example.com/swagger-ui-bundle.js" in response.text
    assert "https://example.com/swagger-ui.css" in response.text
    assert "https://example.com/favicon.png" in response.text
    assert "swagger-ui-dist" not in response.text


def test_redoc_with_custom_cdn_urls():
    response = client.get("/redoc")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "text/html; charset=utf-8"
    assert "https://example.com/redoc.standalone.js" in response.text
    assert "https://example.com/favicon.png" in response.text
    assert "fonts.googleapis.com" not in response.text


def test_response():
    response = client.get("/items/")
    assert response.json() == {"id": "foo"}
