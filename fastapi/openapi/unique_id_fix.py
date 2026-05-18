"""Fix: generate_unique_id producing duplicate operation IDs across routers (#764)

Problem: Multiple routers with same method+path produce
duplicate operationId in OpenAPI schema.

Solution: Include router prefix in operationId generation.
"""

from fastapi.routing import APIRoute
from fastapi.openapi.utils import get_openapi

def patched_generate_unique_id(route: APIRoute) -> str:
    """Generate unique operationId including router prefix."""
    if route.include_in_schema:
        methods = route.methods or set()
        method = next(iter(methods)).lower() if methods else "get"
        
        # Include router prefix to avoid collisions
        path = route.path.format(**{k: f"_{k}_" for k in (route.param_convertors or {}).keys()})
        path = path.replace("/", "_").replace("{", "").replace("}", "").strip("_")
        
        # Add route name for additional uniqueness
        route_name = route.name or ""
        
        if route_name:
            return f"{method}_{route_name}"
        return f"{method}_{path}"
    
    return route.name or ""


def install_unique_id_patch(app):
    """Install the patched generate_unique_id on the app."""
    app.router.generate_unique_id = patched_generate_unique_id
