import inspect

from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html


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


def test_google_fonts_in_generated_redoc():
    body_with_google_fonts = get_redoc_html(
        openapi_url="/docs", title="title"
    ).body.decode()
    assert "fonts.googleapis.com" in body_with_google_fonts
    body_without_google_fonts = get_redoc_html(
        openapi_url="/docs", title="title", with_google_fonts=False
    ).body.decode()
    assert "fonts.googleapis.com" not in body_without_google_fonts


def test_fastapi_custom_cdn_urls():
    """Test that FastAPI class accepts custom CDN URLs."""
    from fastapi import FastAPI
    
    app = FastAPI(
        swagger_js_url="https://custom-cdn.com/swagger-ui-bundle.js",
        swagger_css_url="https://custom-cdn.com/swagger-ui.css",
        swagger_favicon_url="https://custom-cdn.com/favicon.ico",
        redoc_js_url="https://custom-cdn.com/redoc.standalone.js",
        redoc_favicon_url="https://custom-cdn.com/favicon.ico",
    )
    
    assert app.swagger_js_url == "https://custom-cdn.com/swagger-ui-bundle.js"
    assert app.swagger_css_url == "https://custom-cdn.com/swagger-ui.css"
    assert app.swagger_favicon_url == "https://custom-cdn.com/favicon.ico"
    assert app.redoc_js_url == "https://custom-cdn.com/redoc.standalone.js"
    assert app.redoc_favicon_url == "https://custom-cdn.com/favicon.ico"
