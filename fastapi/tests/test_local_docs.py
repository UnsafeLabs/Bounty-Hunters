import inspect

from fastapi import FastAPI
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html
from fastapi.testclient import TestClient


def test_strings_in_generated_swagger():
    sig = inspect.signature(get_swagger_ui_html)
    swagger_js_url = sig.parameters.get("swagger_js_url").default  # type: ignore
    swagger_css_url = sig.parameters.get("swagger_css_url").default  # type: ignore
    swagger_favicon_url = sig.parameters.get("swagger_favicon_url").default  # type: ignore
    html = get_swagger_ui_html(openapi_url="/docs", title="title")
    body_content = html.body.decode()
    assert swagger_js_url in body_content
    assert swagger_css_url in body_content
    assert swagger_favicon_url in body_content
    assert "swagger-ui-dist@5.32.6" in body_content


def test_strings_in_custom_swagger():
    swagger_js_url = "swagger_fake_file.js"
    swagger_css_url = "swagger_fake_file.css"
    swagger_favicon_url = "swagger_fake_file.png"
    html = get_swagger_ui_html(
        openapi_url="/docs",
        title="title",
        swagger_js_url=swagger_js_url,
        swagger_css_url=swagger_css_url,
        swagger_favicon_url=swagger_favicon_url,
    )
    body_content = html.body.decode()
    assert swagger_js_url in body_content
    assert swagger_css_url in body_content
    assert swagger_favicon_url in body_content
    assert "swagger-ui-dist@5.32.6" not in body_content


def test_fastapi_uses_custom_swagger_asset_urls():
    app = FastAPI(
        swagger_js_url="https://assets.example.com/swagger.js",
        swagger_css_url="https://assets.example.com/swagger.css",
        swagger_favicon_url="https://assets.example.com/favicon.png",
    )
    response = TestClient(app).get("/docs")

    body_content = response.text
    assert "https://assets.example.com/swagger.js" in body_content
    assert "https://assets.example.com/swagger.css" in body_content
    assert "https://assets.example.com/favicon.png" in body_content
    assert "swagger-ui-dist@5.32.6" not in body_content


def test_strings_in_generated_redoc():
    sig = inspect.signature(get_redoc_html)
    redoc_js_url = sig.parameters.get("redoc_js_url").default  # type: ignore
    redoc_favicon_url = sig.parameters.get("redoc_favicon_url").default  # type: ignore
    html = get_redoc_html(openapi_url="/docs", title="title")
    body_content = html.body.decode()
    assert redoc_js_url in body_content
    assert redoc_favicon_url in body_content
    assert "redoc@2.5.2" in body_content


def test_strings_in_custom_redoc():
    redoc_js_url = "fake_redoc_file.js"
    redoc_favicon_url = "fake_redoc_file.png"
    html = get_redoc_html(
        openapi_url="/docs",
        title="title",
        redoc_js_url=redoc_js_url,
        redoc_favicon_url=redoc_favicon_url,
    )
    body_content = html.body.decode()
    assert redoc_js_url in body_content
    assert redoc_favicon_url in body_content
    assert "redoc@2.5.2" not in body_content


def test_fastapi_uses_custom_redoc_asset_urls():
    app = FastAPI(
        redoc_js_url="https://assets.example.com/redoc.js",
        redoc_favicon_url="https://assets.example.com/redoc-favicon.png",
    )
    response = TestClient(app).get("/redoc")

    body_content = response.text
    assert "https://assets.example.com/redoc.js" in body_content
    assert "https://assets.example.com/redoc-favicon.png" in body_content
    assert "redoc@2.5.2" not in body_content


def test_google_fonts_in_generated_redoc():
    body_with_google_fonts = get_redoc_html(
        openapi_url="/docs", title="title"
    ).body.decode()
    assert "fonts.googleapis.com" in body_with_google_fonts
    body_without_google_fonts = get_redoc_html(
        openapi_url="/docs", title="title", with_google_fonts=False
    ).body.decode()
    assert "fonts.googleapis.com" not in body_without_google_fonts
