"""
SecureAPIRateLimiter — Rate-limited API key authentication with deprecated key support.

Extends APIKeyHeader with:
- Sliding window rate limiting per API key
- Deprecated key support (Warning header on response)
- 429 Too Many Requests with Retry-After header
"""
import time
import threading
from typing import Annotated, Callable

from fastapi.openapi.models import APIKey, APIKeyIn
from fastapi.security.base import SecurityBase
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import Response
from starlette.status import HTTP_401_UNAUTHORIZED, HTTP_429_TOO_MANY_REQUESTS


class _RateLimitStore:
    """Thread-safe sliding window rate limiter per API key."""
    def __init__(self):
        self._lock = threading.Lock()
        self._counters: dict[str, list[float]] = {}

    def _clean(self, key: str, window: int, now: float):
        cutoff = now - window
        self._counters[key] = [t for t in self._counters.get(key, []) if t > cutoff]

    def check(self, key: str, limit: int, window: int) -> tuple[bool, int]:
        now = time.time()
        with self._lock:
            self._clean(key, window, now)
            counts = self._counters.get(key, [])
            if len(counts) >= limit:
                retry_after = int(window - (now - counts[0])) + 1
                return False, max(retry_after, 1)
            counts.append(now)
            self._counters[key] = counts
            return True, 0


_global_store = _RateLimitStore()


def _parse_rate_limit(rate_limit: str) -> tuple[int, int]:
    parts = rate_limit.split("/")
    if len(parts) != 2:
        raise ValueError(f"Invalid rate_limit format '{rate_limit}'. Use '100/minute'.")
    try:
        limit = int(parts[0])
    except ValueError:
        raise ValueError(f"Invalid limit number in rate_limit '{rate_limit}'.")
    unit = parts[1].strip().lower()
    window_map = {"second": 1, "seconds": 1, "minute": 60, "minutes": 60, "hour": 3600, "hours": 3600}
    if unit not in window_map:
        raise ValueError(f"Invalid unit '{unit}'. Use 'minute' or 'hour'.")
    return limit, window_map[unit]


class SecureAPIRateLimiter(SecurityBase):
    def __init__(self, *, name: str, rate_limit: str = "100/minute", deprecated_keys: list[str] | None = None, scheme_name: str | None = None, description: str | None = None, auto_error: bool = True):
        self.model: APIKey = APIKey(**{"in": APIKeyIn.header}, name=name, description=description or f"API key auth with rate limiting ({rate_limit})")
        self.scheme_name = scheme_name or self.__class__.__name__
        self.auto_error = auto_error
        self._header_name = name
        self._limit, self._window = _parse_rate_limit(rate_limit)
        self._deprecated_keys = set(deprecated_keys or [])
        self._store = _global_store

    async def __call__(self, request: Request) -> str:
        api_key = request.headers.get(self._header_name)
        if not api_key:
            if self.auto_error:
                raise HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail="Not authenticated", headers={"WWW-Authenticate": "APIKey"})
            return None
        allowed, retry_after = self._store.check(api_key, self._limit, self._window)
        if not allowed:
            raise HTTPException(status_code=HTTP_429_TOO_MANY_REQUESTS, detail="Rate limit exceeded.", headers={"Retry-After": str(retry_after)})
        if api_key in self._deprecated_keys:
            request.state._warning = f'299 - "{self.scheme_name}: This API key is deprecated."'
        return api_key

    def update_deprecated_keys(self, keys: list[str]):
        self._deprecated_keys = set(keys)
