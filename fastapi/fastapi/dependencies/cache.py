from typing import Any, Callable, TypeVar
from functools import wraps

T = TypeVar("T")

_request_cache: dict[str, dict[str, Any]] = {}


def request_scoped_cache(key: str) -> Callable[[Callable[..., T]], Callable[..., T]]:
    """Decorator that caches dependency resolution results within a single request scope."""

    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> T:
            request_id = kwargs.get("_request_id", "global")
            cache_key = f"{func.__module__}.{func.__qualname__}:{key}"

            if request_id in _request_cache and cache_key in _request_cache[request_id]:
                return _request_cache[request_id][cache_key]

            result = func(*args, **kwargs)

            if request_id not in _request_cache:
                _request_cache[request_id] = {}
            _request_cache[request_id][cache_key] = result

            return result

        return wrapper

    return decorator


def clear_request_cache(request_id: str) -> None:
    """Clear the cache for a specific request."""
    _request_cache.pop(request_id, None)


def get_cached_value(request_id: str, key: str) -> Any | None:
    """Get a cached value for a specific request."""
    return _request_cache.get(request_id, {}).get(key)
