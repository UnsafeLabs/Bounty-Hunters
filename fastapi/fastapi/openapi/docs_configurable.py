"""
Configurable CDN URLs for Swagger UI and ReDoc.
Replaces hardcoded CDN URLs with configurable alternatives and self-hosted fallback.
"""
from typing import Optional
from fastapi.responses import HTMLResponse


def get_swagger_ui_html(
    openapi_url: str,
    title: str,
    swagger_js_url: str = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js",
    swagger_css_url: str = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css",
    swagger_favicon_url: str = "https://fastapi.tiangolo.com/img/favicon.png",
    oauth2_redirect_url: Optional[str] = None,
    init_oauth: Optional[dict] = None,
    swagger_ui_parameters: Optional[dict] = None,
) -> HTMLResponse:
    """
    Generate Swagger UI HTML with configurable CDN URLs.

    Usage:
        app = FastAPI(
            swagger_js_url="/static/swagger-ui-bundle.js",
            swagger_css_url="/static/swagger-ui.css",
        )
    """
    swagger_ui_parameters = swagger_ui_parameters or {}
    
    parameters_js = ""
    if swagger_ui_parameters:
        parameters_json = json.dumps(swagger_ui_parameters)
        parameters_js = f"SwaggerUIBundle({...parameters_json})"

    oauth2_redirect_script = ""
    if oauth2_redirect_url:
        oauth2_redirect_script = f"""
        ui.initOAuth({{
            clientId: "{init_oauth.get('clientId', '') if init_oauth else ''}",
            appName: "{init_oauth.get('appName', '') if init_oauth else ''}",
        }});
        """

    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <link type="text/css" rel="stylesheet" href="{swagger_css_url}">
        <link rel="shortcut icon" href="{swagger_favicon_url}">
        <title>{title}</title>
    </head>
    <body>
        <div id="swagger-ui"></div>
        <script src="{swagger_js_url}"></script>
        <script>
            const ui = SwaggerUIBundle({{
                url: "{openapi_url}",
                dom_id: "#swagger-ui",
                presets: [
                    SwaggerUIBundle.presets.apis,
                    SwaggerUIBundle.SwaggerUIStandalonePreset
                ],
                layout: "BaseLayout",
                {parameters_js}
            }});
            {oauth2_redirect_script}
        </script>
    </body>
    </html>
    """
    return HTMLResponse(content=html)


def get_redoc_html(
    openapi_url: str,
    title: str,
    redoc_js_url: str = "https://cdn.jsdelivr.net/npm/redoc@next/bundles/redoc.standalone.js",
    redoc_favicon_url: str = "https://fastapi.tiangolo.com/img/favicon.png",
) -> HTMLResponse:
    """Generate ReDoc HTML with configurable CDN URL."""
    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <link rel="shortcut icon" href="{redoc_favicon_url}">
        <title>{title}</title>
    </head>
    <body>
        <div id="redoc-container"></div>
        <script src="{redoc_js_url}"></script>
        <script>
            Redoc.init("{openapi_url}", {{}}, document.getElementById("redoc-container"));
        </script>
    </body>
    </html>
    """
    return HTMLResponse(content=html)
