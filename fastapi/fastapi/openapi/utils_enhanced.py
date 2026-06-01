"""
Fix get_openapi to include server, contact, and license information.
"""
from typing import Optional, List, Dict, Any


def get_openapi_with_server_info(
    title: str,
    version: str,
    openapi_version: str = "3.1.0",
    description: Optional[str] = None,
    routes: Optional[List] = None,
    servers: Optional[List[Dict[str, str]]] = None,
    contact: Optional[Dict[str, str]] = None,
    license_info: Optional[Dict[str, str]] = None,
    tags: Optional[List[Dict[str, str]]] = None,
    **kwargs,
) -> Dict[str, Any]:
    """
    Generate OpenAPI schema with server, contact, and license info.

    Usage:
        schema = get_openapi_with_server_info(
            title="My API",
            version="1.0.0",
            servers=[{"url": "https://api.example.com", "description": "Production"}],
            contact={"name": "Support", "email": "support@example.com"},
            license_info={"name": "MIT", "url": "https://opensource.org/licenses/MIT"},
        )
    """
    info = {
        "title": title,
        "version": version,
    }

    if description:
        info["description"] = description

    if contact:
        info["contact"] = contact

    if license_info:
        info["license"] = license_info

    schema = {
        "openapi": openapi_version,
        "info": info,
        "paths": {},
    }

    if servers:
        schema["servers"] = servers

    if tags:
        schema["tags"] = tags

    # Process routes if provided
    if routes:
        for route in routes:
            if hasattr(route, "path") and hasattr(route, "methods"):
                path = route.path
                if path not in schema["paths"]:
                    schema["paths"][path] = {}

                for method in route.methods:
                    operation = {
                        "summary": getattr(route, "summary", ""),
                        "operationId": getattr(route, "operation_id", ""),
                        "responses": {"200": {"description": "Successful response"}},
                    }

                    if hasattr(route, "tags") and route.tags:
                        operation["tags"] = route.tags

                    schema["paths"][path][method.lower()] = operation

    return schema
