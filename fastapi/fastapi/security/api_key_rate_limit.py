"""Rate-limited API key authentication for FastAPI."""

from __future__ import annotations

import time
import threading
from collections import defaultdict, deque
from typing import Annotated

from annotated_doc import Doc
from fastapi.openapi.models import APIKeyIn
from fastapi.security.api_key import (
    APIKeyBase,
    APIKeyHeader,
    APIKeyQuery,
    APIKeyCookie,
)
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.status import HTTP_429_TOO_MANY_REQUESTS


class _SlidingWindowCounter:
    """Thread-safe sliding window rate limiter using request timestamps.

    Maintains a deque of request timestamps per key and evicts entries
    older than the window. Accurate and simple.
    """

    def __init__(self, max_requests: int, window_seconds: float) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._lock = threading.Lock()
        # key -> sorted list of request timestamps (monotonic)
        self._timestamps: dict[str, list[float]] = defaultdict(list)

    def is_allowed(self, key: str) -> tuple[bool, int]:
        """Check if a request is allowed for the given key.

        Returns (allowed, retry_after_seconds).
        """
        now = time.monotonic()
        cutoff = now - self.window_seconds

        with self._lock:
            ts = self._timestamps[key]
            # Evict expired timestamps
            # Since timestamps are sorted, find the first one within window
            while ts and ts[0] <= cutoff:
                ts.pop(0)

            if len(ts) >= self.max_requests:
                # Rate limited — retry after the oldest entry expires
                retry_after = max(1, int(ts[0] - cutoff))
                return False, retry_after

            ts.append(now)
            return True, 0

    def reset(self, key: str) -> None:
        """Reset counters for a specific key."""
        with self._lock:
            self._timestamps.pop(key, None)


class APIKeyWithRateLimit(APIKeyHeader):
    """API key header authentication with sliding-window rate limiting.

    Extends :class:`APIKeyHeader` to track request counts per API key and
    return ``429 Too Many Requests`` with a ``Retry-After`` header when the
    configured limit is exceeded.

    Usage::

        scheme = APIKeyWithRateLimit(
            name="X-API-Key",
            rate_limit="100/minute",
            deprecated_keys=["old-key-1", "old-key-2"],
        )

        @app.get("/items")
        async def read_items(api_key: str = Depends(scheme)):
            return {"api_key": api_key}

    :param rate_limit: Rate limit string, e.g. ``"100/minute"`` or ``"1000/hour"``.
    :param deprecated_keys: Old API keys that still authenticate but receive a
        ``Warning`` header in the response.
    """

    def __init__(
        self,
        *,
        name: Annotated[str, Doc("Header name.")],
        rate_limit: Annotated[
            str,
            Doc(
                'Rate limit as "N/period", e.g. "100/minute" or "1000/hour". '
                "Supported periods: second, minute, hour, day."
            ),
        ] = "100/minute",
        deprecated_keys: Annotated[
            list[str] | None,
            Doc("Old API keys that still work but receive a Warning header."),
        ] = None,
        scheme_name: str | None = None,
        description: str | None = None,
        auto_error: bool = True,
    ):
        super().__init__(
            name=name,
            scheme_name=scheme_name,
            description=description,
            auto_error=auto_error,
        )
        self.deprecated_keys: set[str] = set(deprecated_keys or [])
        self._limiter = _SlidingWindowCounter(*self._parse_rate_limit(rate_limit))

    @staticmethod
    def _parse_rate_limit(rate_limit: str) -> tuple[int, float]:
        """Parse 'N/period' into (max_requests, window_seconds)."""
        period_map = {
            "second": 1.0,
            "minute": 60.0,
            "hour": 3600.0,
            "day": 86400.0,
        }
        try:
            count_str, period = rate_limit.split("/")
            count = int(count_str)
            period = period.strip().lower()
            if period.endswith("s"):
                period = period[:-1]
            if period not in period_map or count <= 0:
                raise ValueError
            return count, period_map[period]
        except (ValueError, AttributeError):
            raise ValueError(
                f"Invalid rate_limit format: {rate_limit!r}. "
                'Expected "N/period" like "100/minute".'
            )

    async def __call__(self, request: Request) -> str | None:
        api_key = request.headers.get(self.model.name)

        if not api_key:
            if self.auto_error:
                raise self.make_not_authenticated_error()
            return None

        # Check rate limit
        allowed, retry_after = self._limiter.is_allowed(api_key)
        if not allowed:
            raise HTTPException(
                status_code=HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded",
                headers={"Retry-After": str(retry_after)},
            )

        return api_key

    def get_warning_header(self, api_key: str) -> dict[str, str] | None:
        """Return Warning headers if the key is deprecated, else None.

        Call this in your endpoint or a middleware to attach the warning
        to the response.
        """
        if api_key in self.deprecated_keys:
            return {
                "Warning": '299 - "API key is deprecated and will be removed in a future release"'
            }
        return None


class APIKeyQueryWithRateLimit(APIKeyQuery):
    """API key query parameter authentication with sliding-window rate limiting.

    Same as :class:`APIKeyWithRateLimit` but reads the key from a query parameter.
    """

    def __init__(
        self,
        *,
        name: Annotated[str, Doc("Query parameter name.")],
        rate_limit: str = "100/minute",
        deprecated_keys: list[str] | None = None,
        scheme_name: str | None = None,
        description: str | None = None,
        auto_error: bool = True,
    ):
        super().__init__(
            name=name,
            scheme_name=scheme_name,
            description=description,
            auto_error=auto_error,
        )
        self.deprecated_keys: set[str] = set(deprecated_keys or [])
        self._limiter = _SlidingWindowCounter(*self._parse_rate_limit(rate_limit))

    @staticmethod
    def _parse_rate_limit(rate_limit: str) -> tuple[int, float]:
        period_map = {
            "second": 1.0,
            "minute": 60.0,
            "hour": 3600.0,
            "day": 86400.0,
        }
        try:
            count_str, period = rate_limit.split("/")
            count = int(count_str)
            period = period.strip().lower()
            if period.endswith("s"):
                period = period[:-1]
            if period not in period_map or count <= 0:
                raise ValueError
            return count, period_map[period]
        except (ValueError, AttributeError):
            raise ValueError(
                f"Invalid rate_limit format: {rate_limit!r}. "
                'Expected "N/period" like "100/minute".'
            )

    async def __call__(self, request: Request) -> str | None:
        api_key = request.query_params.get(self.model.name)

        if not api_key:
            if self.auto_error:
                raise self.make_not_authenticated_error()
            return None

        allowed, retry_after = self._limiter.is_allowed(api_key)
        if not allowed:
            raise HTTPException(
                status_code=HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded",
                headers={"Retry-After": str(retry_after)},
            )

        return api_key

    def get_warning_header(self, api_key: str) -> dict[str, str] | None:
        if api_key in self.deprecated_keys:
            return {
                "Warning": '299 - "API key is deprecated and will be removed in a future release"'
            }
        return None


class APIKeyCookieWithRateLimit(APIKeyCookie):
    """API key cookie authentication with sliding-window rate limiting.

    Same as :class:`APIKeyWithRateLimit` but reads the key from a cookie.
    """

    def __init__(
        self,
        *,
        name: Annotated[str, Doc("Cookie name.")],
        rate_limit: str = "100/minute",
        deprecated_keys: list[str] | None = None,
        scheme_name: str | None = None,
        description: str | None = None,
        auto_error: bool = True,
    ):
        super().__init__(
            name=name,
            scheme_name=scheme_name,
            description=description,
            auto_error=auto_error,
        )
        self.deprecated_keys: set[str] = set(deprecated_keys or [])
        self._limiter = _SlidingWindowCounter(*self._parse_rate_limit(rate_limit))

    @staticmethod
    def _parse_rate_limit(rate_limit: str) -> tuple[int, float]:
        period_map = {
            "second": 1.0,
            "minute": 60.0,
            "hour": 3600.0,
            "day": 86400.0,
        }
        try:
            count_str, period = rate_limit.split("/")
            count = int(count_str)
            period = period.strip().lower()
            if period.endswith("s"):
                period = period[:-1]
            if period not in period_map or count <= 0:
                raise ValueError
            return count, period_map[period]
        except (ValueError, AttributeError):
            raise ValueError(
                f"Invalid rate_limit format: {rate_limit!r}. "
                'Expected "N/period" like "100/minute".'
            )

    async def __call__(self, request: Request) -> str | None:
        api_key = request.cookies.get(self.model.name)

        if not api_key:
            if self.auto_error:
                raise self.make_not_authenticated_error()
            return None

        allowed, retry_after = self._limiter.is_allowed(api_key)
        if not allowed:
            raise HTTPException(
                status_code=HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded",
                headers={"Retry-After": str(retry_after)},
            )

        return api_key

    def get_warning_header(self, api_key: str) -> dict[str, str] | None:
        if api_key in self.deprecated_keys:
            return {
                "Warning": '299 - "API key is deprecated and will be removed in a future release"'
            }
        return None
