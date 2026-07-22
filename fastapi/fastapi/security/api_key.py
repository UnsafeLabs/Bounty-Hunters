from __future__ import annotations

import re
import threading
import time
from collections import defaultdict
from typing import Annotated, Dict, List, Optional, Tuple

from annotated_doc import Doc
from fastapi.exceptions import HTTPException
from fastapi.openapi.models import APIKey, APIKeyIn
from fastapi.security.base import SecurityBase
from starlette.requests import Request
from starlette.responses import Response
from starlette.status import HTTP_401_UNAUTHORIZED, HTTP_429_TOO_MANY_REQUESTS


def parse_rate_limit(rate_limit: str) -> Tuple[int, int]:
    """Parse rate limit string like '100/minute', '1000/hour', '10/second'.

    Returns:
        Tuple of (max_requests, window_seconds)

    Raises:
        ValueError: If format is invalid
    """
    match = re.match(r"^(\d+)/(second|minute|hour|day)$", rate_limit.lower())
    if not match:
        raise ValueError(
            f"Invalid rate limit format: '{rate_limit}'. "
            f"Expected format: '<number>/<period>' (e.g., '100/minute')"
        )

    max_requests = int(match.group(1))
    period = match.group(2)

    window_map = {
        "second": 1,
        "minute": 60,
        "hour": 3600,
        "day": 86400,
    }

    return max_requests, window_map[period]


class RateLimitStore:
    """Thread-safe in-memory rate limit store using sliding window algorithm."""

    def __init__(self) -> None:
        self._requests: Dict[str, List[float]] = defaultdict(list)
        self._lock = threading.Lock()

    def check_and_update(
        self,
        key: str,
        max_requests: int,
        window_seconds: int,
    ) -> Tuple[bool, Optional[int]]:
        """Check if request is allowed and update the store.

        Args:
            key: The rate limit key (usually the API key)
            max_requests: Maximum number of requests allowed in window
            window_seconds: Time window in seconds

        Returns:
            Tuple of (allowed, retry_after_seconds)
            - allowed: True if request is allowed, False if rate limited
            - retry_after_seconds: Seconds to wait before retry (None if allowed)
        """
        now = time.time()
        window_start = now - window_seconds

        with self._lock:
            # Remove old entries outside the window
            self._requests[key] = [
                ts for ts in self._requests[key] if ts > window_start
            ]

            # Check if we're over the limit
            if len(self._requests[key]) >= max_requests:
                # Calculate retry_after based on oldest request in window
                oldest = self._requests[key][0]
                retry_after = int(oldest + window_seconds - now) + 1
                return False, max(retry_after, 1)

            # Add current request
            self._requests[key].append(now)
            return True, None

    def get_usage(self, key: str, window_seconds: int) -> int:
        """Get current usage count for a key."""
        now = time.time()
        window_start = now - window_seconds

        with self._lock:
            return sum(1 for ts in self._requests.get(key, []) if ts > window_start)


class APIKeyBase(SecurityBase):
    """Base class for API key authentication."""

    model: APIKey
    scheme_name: str
    auto_error: bool = True

    def make_not_authenticated_error(self) -> HTTPException:
        return HTTPException(
            status_code=HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "APIKey"},
        )

    def check_api_key(self, api_key: str | None) -> str | None:
        if not api_key:
            if self.auto_error:
                raise self.make_not_authenticated_error()
            return None
        return api_key


class APIKeyQuery(APIKeyBase):
    """API key authentication using a query parameter."""

    def __init__(
        self,
        *,
        name: Annotated[str, Doc("Query parameter name.")],
        scheme_name: Annotated[str | None, Doc("Security scheme name.")] = None,
        description: Annotated[str | None, Doc("Security scheme description.")] = None,
        auto_error: Annotated[
            bool, Doc("Whether to raise error on missing key.")
        ] = True,
    ):
        self.auto_error = auto_error
        self.model: APIKey = APIKey(
            **{"in": APIKeyIn.query},  # ty: ignore[invalid-argument-type]
            name=name,
            description=description,
        )
        self.scheme_name = scheme_name or self.__class__.__name__

    async def __call__(self, request: Request) -> str | None:
        api_key = request.query_params.get(self.model.name)
        return self.check_api_key(api_key)


class APIKeyHeader(APIKeyBase):
    """API key authentication using a header."""

    def __init__(
        self,
        *,
        name: Annotated[str, Doc("Header name.")],
        scheme_name: Annotated[str | None, Doc("Security scheme name.")] = None,
        description: Annotated[str | None, Doc("Security scheme description.")] = None,
        auto_error: Annotated[
            bool, Doc("Whether to raise error on missing key.")
        ] = True,
    ):
        self.auto_error = auto_error
        self.model: APIKey = APIKey(
            **{"in": APIKeyIn.header},  # ty: ignore[invalid-argument-type]
            name=name,
            description=description,
        )
        self.scheme_name = scheme_name or self.__class__.__name__

    async def __call__(self, request: Request) -> str | None:
        api_key = request.headers.get(self.model.name)
        return self.check_api_key(api_key)


class APIKeyCookie(APIKeyBase):
    """API key authentication using a cookie."""

    def __init__(
        self,
        *,
        name: Annotated[str, Doc("Cookie name.")],
        scheme_name: Annotated[str | None, Doc("Security scheme name.")] = None,
        description: Annotated[str | None, Doc("Security scheme description.")] = None,
        auto_error: Annotated[
            bool, Doc("Whether to raise error on missing key.")
        ] = True,
    ):
        self.auto_error = auto_error
        self.model: APIKey = APIKey(
            **{"in": APIKeyIn.cookie},  # ty: ignore[invalid-argument-type]
            name=name,
            description=description,
        )
        self.scheme_name = scheme_name or self.__class__.__name__

    async def __call__(self, request: Request) -> str | None:
        api_key = request.cookies.get(self.model.name)
        return self.check_api_key(api_key)


class APIKeyWithRateLimit(APIKeyBase):
    """API Key authentication with rate limiting and deprecation warnings.

    Features:
        - Configurable rate limiting per API key
        - Automatic rate limit enforcement with 429 responses
        - Retry-After header in rate limit responses
        - Deprecation warnings via Warning response header
        - Thread-safe rate limit store
        - Independent rate limits per API key

    Args:
        name: Header/query parameter name for the API key
        scheme_name: Optional name for OpenAPI documentation
        auto_error: Whether to raise error on missing key
        rate_limit: Rate limit string (e.g., '100/minute', '1000/hour')
        deprecated_keys: List of deprecated API keys that trigger warnings

    Example:
        scheme = APIKeyWithRateLimit(
            name="X-API-Key",
            rate_limit="100/minute",
            deprecated_keys=["old-key-1", "old-key-2"],
        )
    """

    def __init__(
        self,
        *,
        name: Annotated[str, Doc("Header name.")],
        scheme_name: Annotated[str | None, Doc("Security scheme name.")] = None,
        description: Annotated[str | None, Doc("Security scheme description.")] = None,
        auto_error: Annotated[
            bool, Doc("Whether to raise error on missing key.")
        ] = True,
        rate_limit: Annotated[
            str, Doc("Rate limit string (e.g., '100/minute')")
        ] = "100/minute",
        deprecated_keys: Annotated[
            Optional[List[str]], Doc("List of deprecated API keys that trigger warnings")
        ] = None,
    ):
        self.auto_error = auto_error
        self.model: APIKey = APIKey(
            **{"in": APIKeyIn.header},  # ty: ignore[invalid-argument-type]
            name=name,
            description=description,
        )
        self.scheme_name = scheme_name or self.__class__.__name__
        self.deprecated_keys = deprecated_keys or []

        # Parse rate limit
        self.max_requests, self.window_seconds = parse_rate_limit(rate_limit)
        self._store = RateLimitStore()

    async def __call__(self, request: Request, response: Response) -> str | None:
        api_key = request.headers.get(self.model.name)

        if not api_key:
            if self.auto_error:
                raise self.make_not_authenticated_error()
            return None

        # Check rate limit
        allowed, retry_after = self._store.check_and_update(
            key=api_key,
            max_requests=self.max_requests,
            window_seconds=self.window_seconds,
        )

        if not allowed:
            raise HTTPException(
                status_code=HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded",
                headers={"Retry-After": str(retry_after)},
            )

        # Check if key is deprecated and add Warning header to response
        if api_key in self.deprecated_keys:
            response.headers.append(
                "Warning",
                '299 - "API key is deprecated and will be deactivated soon. '
                'Please rotate to a new key."',
            )

        return api_key
