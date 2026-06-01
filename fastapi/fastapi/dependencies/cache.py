"""
Request-scoped dependency caching for FastAPI.
Prevents duplicate resolution of the same dependency within a single request.
"""
from typing import Any, Callable, Dict, Optional, Tuple
from functools import wraps
import inspect


class DependencyCache:
    """
    Request-scoped cache for dependency injection results.

    Usage:
        cache = DependencyCache()

        @cache.cached
        def get_db():
            return create_db_session()

        @cache.cached
        def get_current_user(db = Depends(get_db)):
            return fetch_user(db)
    """

    def __init__(self):
        self._cache: Dict[Tuple, Any] = {}
        self._request_id: Optional[str] = None

    def set_request(self, request_id: str) -> None:
        """Set the current request context."""
        if request_id != self._request_id:
            self._cache.clear()
            self._request_id = request_id

    def cached(self, func: Callable) -> Callable:
        """
        Decorator that caches the result of a dependency function.

        The cache key is based on the function name and its arguments.
        Results are scoped to the current request.
        """
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Create cache key from function and arguments
            cache_key = (func.__qualname__, str(args), str(sorted(kwargs.items())))

            if cache_key in self._cache:
                return self._cache[cache_key]

            # Resolve dependency
            if inspect.iscoroutinefunction(func):
                result = await func(*args, **kwargs)
            else:
                result = func(*args, **kwargs)

            self._cache[cache_key] = result
            return result

        # Preserve FastAPI dependency metadata
        wrapper._dependency_cache = True
        if hasattr(func, '__annotations__'):
            wrapper.__annotations__ = func.__annotations__
        return wrapper

    def clear(self) -> None:
        """Clear the cache (called at end of request)."""
        self._cache.clear()
        self._request_id = None

    def get_or_set(self, key: str, factory: Callable) -> Any:
        """Get a cached value or create it with the factory."""
        if key in self._cache:
            return self._cache[key]
        result = factory()
        self._cache[key] = result
        return result


# Global instance for convenience
dependency_cache = DependencyCache()
