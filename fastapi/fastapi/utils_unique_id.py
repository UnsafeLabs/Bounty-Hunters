"""
Fix generate_unique_id to prevent duplicate operation IDs across routers.
"""
from typing import Callable, Optional, Sequence


def generate_unique_id(
    route: "APIRoute",
    *,
    operation_id_format: str = "{method}_{path}",
    tag_prefix: bool = True,
) -> str:
    """
    Generate unique operation ID for OpenAPI routes.

    Prevents duplicates by including:
    - HTTP method
    - Full path with parameters
    - Router tag prefix (if enabled)
    - Function name with module prefix
    """
    # Get function name
    func_name = route.endpoint.__name__ if hasattr(route.endpoint, '__name__') else "unknown"

    # Get module path for uniqueness
    module = getattr(route.endpoint, '__module__', '')
    if module:
        # Use last two parts of module path
        module_parts = module.split('.')
        module_prefix = ".".join(module_parts[-2:]) if len(module_parts) >= 2 else module
    else:
        module_prefix = ""

    # Get tags
    tags = route.tags if hasattr(route, 'tags') and route.tags else []
    tag_prefix_str = tags[0] if tag_prefix and tags else ""

    # Get method and path
    method = list(route.methods)[0].lower() if route.methods else "get"
    path = route.path.replace("/", "_").replace("{", "").replace("}", "").strip("_")

    # Build operation ID
    parts = []
    if tag_prefix_str:
        parts.append(tag_prefix_str.lower().replace(" ", "_"))
    if module_prefix:
        parts.append(module_prefix.replace(".", "_"))
    parts.append(func_name)
    parts.append(method)

    operation_id = "_".join(parts)

    # Ensure uniqueness by adding path hash if needed
    import hashlib
    path_hash = hashlib.md5(route.path.encode()).hexdigest()[:6]
    operation_id = f"{operation_id}_{path_hash}"

    return operation_id
