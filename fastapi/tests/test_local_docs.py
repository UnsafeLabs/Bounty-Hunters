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


def test_strings_in_generated_redoc():
    sig = inspect.signature(get_redoc_html)
    redoc_js_url = sig.parameters.get("redoc_js_url").default  # type: ignore
    redoc_favicon_url = sig.parameters.get("redoc_favicon_url").default  # type: ignore
    html = get_redoc_html(openapi_url="/docs", title="title")
    body_content = html.body.decode()
    assert redoc_js_url in body_content
    assert redoc_favicon_url in body_content


def test_strings_in_custom_redoc():
    redoc_js_url = "fake_redoc_file.js"
    redoc_css_url = "fake_redoc_file.css"
    redoc_favicon_url = "fake_redoc_file.png"
    html = get_redoc_html(
        openapi_url="/docs",
        title="title",
        redoc_js_url=redoc_js_url,
        redoc_css_url=redoc_css_url,
        redoc_favicon_url=redoc_favicon_url,
    )
    body_content = html.body.decode()
    assert redoc_js_url in body_content
    assert redoc_css_url in body_content
    assert redoc_favicon_url in body_content


def test_google_fonts_in_generated_redoc():
    body_with_google_fonts = get_redoc_html(
        openapi_url="/docs", title="title"
    ).body.decode()
    assert "fonts.googleapis.com" in body_with_google_fonts
    body_without_google_fonts = get_redoc_html(
        openapi_url="/docs", title="title", with_google_fonts=False
    ).body.decode()
    assert "fonts.googleapis.com" not in body_without_google_fonts


def test_fastapi_custom_docs_urls():
    app = FastAPI(
        swagger_js_url="https://example.com/swagger.js",
        swagger_css_url="https://example.com/swagger.css",
        swagger_favicon_url="https://example.com/swagger-favicon.png",
        redoc_js_url="https://example.com/redoc.js",
        redoc_css_url="https://example.com/redoc.css",
        redoc_favicon_url="https://example.com/redoc-favicon.png",
    )
    client = TestClient(app)

    response = client.get("/docs")
    assert response.status_code == 200
    html = response.text
    assert "https://example.com/swagger.js" in html
    assert "https://example.com/swagger.css" in html
    assert "https://example.com/swagger-favicon.png" in html

    response_redoc = client.get("/redoc")
    assert response_redoc.status_code == 200
    html_redoc = response_redoc.text
    assert "https://example.com/redoc.js" in html_redoc
    assert "https://example.com/redoc.css" in html_redoc
    assert "https://example.com/redoc-favicon.png" in html_redoc
