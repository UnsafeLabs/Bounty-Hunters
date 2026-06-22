
"""
Request-scoped dependency caching support.
"""
from typing import Any, Dict
from fastapi import Request

CACHE_KEY = "_dep_cache"


def get_dep_cache(request: Request) -> Dict[int, Any]:
    """Get or create the per-request dependency cache."""
    if not hasattr(request.state, CACHE_KEY):
        setattr(request.state, CACHE_KEY, {})
    return getattr(request.state, CACHE_KEY)


def invalidate_dep_cache(request: Request) -> None:
    """Clear the per-request dependency cache."""
    if hasattr(request.state, CACHE_KEY):
        delattr(request.state, CACHE_KEY)
