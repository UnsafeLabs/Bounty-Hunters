"""Fix: Add request-scoped dependency caching (#795)

Problem: Dependencies are re-resolved on every call within
a request, causing duplicate DB queries and API calls.

Solution: Request-scoped cache that deduplicates dependency
resolution within a single request lifecycle.
"""

from typing import Any, Callable, TypeVar
from functools import wraps
from fastapi import Request

T = TypeVar("T")

_request_cache_key = "_dependency_cache"

def get_request_cache(request: Request) -> dict[str, Any]:
    if not hasattr(request.state, _request_cache_key):
        setattr(request.state, _request_cache_key, {})
    return getattr(request.state, _request_cache_key)

def cached_dependency(func: Callable) -> Callable:
    """Decorator to cache dependency result within request scope."""
    @wraps(func)
    async def wrapper(*args, **kwargs):
        request = None
        for arg in args:
            if isinstance(arg, Request):
                request = arg
                break
        if request is None:
            for v in kwargs.values():
                if isinstance(v, Request):
                    request = v
                    break
        
        if request is None:
            return await func(*args, **kwargs) if asyncio.iscoroutinefunction(func) else func(*args, **kwargs)
        
        cache = get_request_cache(request)
        cache_key = f"{func.__module__}.{func.__qualname__}"
        
        if cache_key not in cache:
            if asyncio.iscoroutinefunction(func):
                cache[cache_key] = await func(*args, **kwargs)
            else:
                cache[cache_key] = func(*args, **kwargs)
        
        return cache[cache_key]
    
    return wrapper


import asyncio
