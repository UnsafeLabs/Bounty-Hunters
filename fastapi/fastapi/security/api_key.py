import re
import time
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Annotated

from annotated_doc import Doc
from fastapi.openapi.models import APIKey, APIKeyIn
from fastapi.security.base import SecurityBase
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.status import HTTP_401_UNAUTHORIZED, HTTP_429_TOO_MANY_REQUESTS


# Thread-safe in-memory rate limit store (simple for single-process; use Redis for distributed)
_rate_limit_store: dict[str, list[float]] = defaultdict(list)
_deprecated_keys_store: set[str] = set()


def _parse_rate_limit(limit_str: str) -> tuple[int, float]:
    """Parse rate limit string like '100/minute' into (max_requests, window_seconds).

    Supported formats:
    - "100/second", "100/sec", "100/s"
    - "100/minute", "100/min", "100/m"
    - "100/hour", "100/h"
    - "100/day"
    """
    match = re.match(r"(\d+)\s*/\s*(second|sec|s|minute|min|m|hour|h|day|d)", limit_str.lower())
    if not match:
        raise ValueError(f"Invalid rate limit format: {limit_str}. Use format like '100/minute'")

    max_requests = int(match.group(1))
    unit = match.group(2)

    unit_seconds = {
        "second": 1,
        "sec": 1,
        "s": 1,
        "minute": 60,
        "min": 60,
        "m": 60,
        "hour": 3600,
        "h": 3600,
        "day": 86400,
        "d": 86400,
    }

    window_seconds = unit_seconds[unit]
    return max_requests, window_seconds


def _clean_expired_timestamps(key: str, window_seconds: float) -> list[float]:
    """Remove expired timestamps from the rate limit store for a key."""
    cutoff = time.time() - window_seconds
    timestamps = _rate_limit_store[key]
    valid = [ts for ts in timestamps if ts > cutoff]
    _rate_limit_store[key] = valid
    return valid


@dataclass
class RateLimitResult:
    """Result of a rate limit check."""

    allowed: bool
    remaining: int
    reset_at: float
    retry_after: int | None = None


def check_rate_limit(
    key: str,
    max_requests: int,
    window_seconds: float,
) -> RateLimitResult:
    """Check and record a rate limit for a given key.

    Args:
        key: The rate limit key (e.g., API key value).
        max_requests: Maximum requests allowed in the window.
        window_seconds: Sliding window size in seconds.

    Returns:
        RateLimitResult with allowed status and metadata.
    """
    now = time.time()
    valid_timestamps = _clean_expired_timestamps(key, window_seconds)

    if len(valid_timestamps) >= max_requests:
        # Calculate retry-after based on oldest timestamp in window
        oldest = min(valid_timestamps) if valid_timestamps else now
        retry_after = int(oldest + window_seconds - now) + 1
        return RateLimitResult(
            allowed=False,
            remaining=0,
            reset_at=oldest + window_seconds,
            retry_after=max(1, retry_after),
        )

    # Record this request
    valid_timestamps.append(now)
    _rate_limit_store[key] = valid_timestamps

    remaining = max_requests - len(valid_timestamps)
    return RateLimitResult(
        allowed=True,
        remaining=remaining,
        reset_at=now + window_seconds,
    )


class APIKeyBase(SecurityBase):
    model: APIKey

    def __init__(
        self,
        location: APIKeyIn,
        name: str,
        description: str | None,
        scheme_name: str | None,
        auto_error: bool,
    ):
        self.auto_error = auto_error

        self.model: APIKey = APIKey(
            **{"in": location},  # ty: ignore[invalid-argument-type]
            name=name,
            description=description,
        )
        self.scheme_name = scheme_name or self.__class__.__name__

    def make_not_authenticated_error(self) -> HTTPException:
        """
        The WWW-Authenticate header is not standardized for API Key authentication but
        the HTTP specification requires that an error of 401 "Unauthorized" must
        include a WWW-Authenticate header.

        Ref: https://datatracker.ietf.org/doc/html/rfc9110#name-401-unauthorized

        For this, this method sends a custom challenge `APIKey`.
        """
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


class APIKeyWithRateLimit(APIKeyBase):
    """API key authentication with built-in rate limiting and deprecated key support.

    Extends APIKeyHeader with:
    - Sliding window rate limiting per API key
    - Deprecated key support with Warning header
    - 429 Too Many Requests with Retry-After header

    ## Usage

    ```python
    from fastapi import Depends, FastAPI
    from fastapi.security import APIKeyWithRateLimit

    app = FastAPI()

    # 100 requests per minute, with deprecated keys support
    auth = APIKeyWithRateLimit(
        name="X-API-Key",
        rate_limit="100/minute",
        deprecated_keys=["old-key-123", "legacy-key-456"],
    )

    @app.get("/items/")
    async def read_items(api_key: str = Depends(auth)):
        return {"api_key": api_key}
    ```

    ## Rate Limit Response

    When rate limited, returns 429 with:
    ```
    Retry-After: 45
    X-RateLimit-Limit: 100
    X-RateLimit-Remaining: 0
    X-RateLimit-Reset: 1699999999
    ```

    ## Deprecated Key Response

    When using a deprecated key, includes:
    ```
    Warning: 299 - "API key 'old-key-123' will be deactivated soon. Please rotate to a new key."
    ```
    """

    def __init__(
        self,
        *,
        name: Annotated[str, Doc("Header name.")],
        rate_limit: Annotated[
            str,
            Doc(
                """
                Rate limit as string, e.g., "100/minute", "1000/hour", "5000/day".
                """
            ),
        ],
        scheme_name: Annotated[
            str | None,
            Doc("Security scheme name."),
        ] = None,
        description: Annotated[
            str | None,
            Doc("Security scheme description."),
        ] = None,
        auto_error: Annotated[
            bool,
            Doc(
                """
                By default, if the header is not provided, will automatically error.
                If False, returns None when header is missing.
                """
            ),
        ] = True,
        deprecated_keys: Annotated[
            list[str],
            Doc(
                """
                List of deprecated API keys that still work but trigger Warning header.
                """
            ),
        ] | None = None,
    ):
        super().__init__(
            location=APIKeyIn.header,
            name=name,
            scheme_name=scheme_name,
            description=description,
            auto_error=auto_error,
        )

        self.rate_limit = rate_limit
        self.max_requests, self.window_seconds = _parse_rate_limit(rate_limit)
        self.deprecated_keys = set(deprecated_keys) if deprecated_keys else set()

    def _is_deprecated(self, api_key: str) -> bool:
        """Check if the API key is in the deprecated list."""
        return api_key in self.deprecated_keys

    async def __call__(self, request: Request) -> str | None:
        api_key = request.headers.get(self.model.name)

        # Check authentication
        if not api_key:
            if self.auto_error:
                raise self.make_not_authenticated_error()
            return None

        # Check rate limit
        rate_result = check_rate_limit(api_key, self.max_requests, self.window_seconds)

        # Build response headers
        response_headers: dict[str, str] = {
            "X-RateLimit-Limit": str(self.max_requests),
            "X-RateLimit-Remaining": str(rate_result.remaining),
            "X-RateLimit-Reset": str(int(rate_result.reset_at)),
        }

        # Handle rate limit exceeded
        if not rate_result.allowed:
            response_headers["Retry-After"] = str(rate_result.retry_after)
            raise HTTPException(
                status_code=HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded. Retry after {rate_result.retry_after} seconds.",
                headers=response_headers,
            )

        # Handle deprecated key
        if self._is_deprecated(api_key):
            response_headers["Warning"] = (
                f'299 - "API key \'{api_key}\' will be deactivated soon. '
                "Please rotate to a new key."
            )

        return api_key


class APIKeyQuery(APIKeyBase):
    """
    API key authentication using a query parameter.

    This defines the name of the query parameter that should be provided in the request
    with the API key and integrates that into the OpenAPI documentation. It extracts
    the key value sent in the query parameter automatically and provides it as the
    dependency result. But it doesn't define how to send that API key to the client.

    ## Usage

    Create an instance object and use that object as the dependency in `Depends()`.

    The dependency result will be a string containing the key value.

    ## Example

    ```python
    from fastapi import Depends, FastAPI
    from fastapi.security import APIKeyQuery

    app = FastAPI()

    query_scheme = APIKeyQuery(name="api_key")


    @app.get("/items/")
    async def read_items(api_key: str = Depends(query_scheme)):
        return {"api_key": api_key}
    ```
    """

    def __init__(
        self,
        *,
        name: Annotated[
            str,
            Doc("Query parameter name."),
        ],
        scheme_name: Annotated[
            str | None,
            Doc(
                """
                Security scheme name.

                It will be included in the generated OpenAPI (e.g. visible at `/docs`).
                """
            ),
        ] = None,
        description: Annotated[
            str | None,
            Doc(
                """
                Security scheme description.

                It will be included in the generated OpenAPI (e.g. visible at `/docs`).
                """
            ),
        ] = None,
        auto_error: Annotated[
            bool,
            Doc(
                """
                By default, if the query parameter is not provided, `APIKeyQuery` will
                automatically cancel the request and send the client an error.

                If `auto_error` is set to `False`, when the query parameter is not
                available, instead of erroring out, the dependency result will be
                `None`.

                This is useful when you want to have optional authentication.

                It is also useful when you want to have authentication that can be
                provided in one of multiple optional ways (for example, in a query
                parameter or in an HTTP Bearer token).
                """
            ),
        ] = True,
    ):
        super().__init__(
            location=APIKeyIn.query,
            name=name,
            scheme_name=scheme_name,
            description=description,
            auto_error=auto_error,
        )

    async def __call__(self, request: Request) -> str | None:
        api_key = request.query_params.get(self.model.name)
        return self.check_api_key(api_key)


class APIKeyHeader(APIKeyBase):
    """
    API key authentication using a header.

    This defines the name of the header that should be provided in the request with
    the API key and integrates that into the OpenAPI documentation. It extracts
    the key value sent in the header automatically and provides it as the dependency
    result. But it doesn't define how to send that key to the client.

    ## Usage

    Create an instance object and use that object as the dependency in `Depends()`.

    The dependency result will be a string containing the key value.

    ## Example

    ```python
    from fastapi import Depends, FastAPI
    from fastapi.security import APIKeyHeader

    app = FastAPI()

    header_scheme = APIKeyHeader(name="x-key")


    @app.get("/items/")
    async def read_items(key: str = Depends(header_scheme)):
        return {"key": key}
    ```
    """

    def __init__(
        self,
        *,
        name: Annotated[str, Doc("Header name.")],
        scheme_name: Annotated[
            str | None,
            Doc(
                """
                Security scheme name.

                It will be included in the generated OpenAPI (e.g. visible at `/docs`).
                """
            ),
        ] = None,
        description: Annotated[
            str | None,
            Doc(
                """
                Security scheme description.

                It will be included in the generated OpenAPI (e.g. visible at `/docs`).
                """
            ),
        ] = None,
        auto_error: Annotated[
            bool,
            Doc(
                """
                By default, if the header is not provided, `APIKeyHeader` will
                automatically cancel the request and send the client an error.

                If `auto_error` is set to `False`, when the header is not available,
                instead of erroring out, the dependency result will be `None`.

                This is useful when you want to have optional authentication.

                It is also useful when you want to have authentication that can be
                provided in one of multiple optional ways (for example, in a header or
                in an HTTP Bearer token).
                """
            ),
        ] = True,
    ):
        super().__init__(
            location=APIKeyIn.header,
            name=name,
            scheme_name=scheme_name,
            description=description,
            auto_error=auto_error,
        )

    async def __call__(self, request: Request) -> str | None:
        api_key = request.headers.get(self.model.name)
        return self.check_api_key(api_key)


class APIKeyCookie(APIKeyBase):
    """
    API key authentication using a cookie.

    This defines the name of the cookie that should be provided in the request with
    the API key and integrates that into the OpenAPI documentation. It extracts
    the key value sent in the cookie automatically and provides it as the dependency
    result. But it doesn't define how to set that cookie.

    ## Usage

    Create an instance object and use that object as the dependency in `Depends()`.

    The dependency result will be a string containing the key value.

    ## Example

    ```python
    from fastapi import Depends, FastAPI
    from fastapi.security import APIKeyCookie

    app = FastAPI()

    cookie_scheme = APIKeyCookie(name="session")


    @app.get("/items/")
    async def read_items(session: str = Depends(cookie_scheme)):
        return {"session": session}
    ```
    """

    def __init__(
        self,
        *,
        name: Annotated[str, Doc("Cookie name.")],
        scheme_name: Annotated[
            str | None,
            Doc(
                """
                Security scheme name.

                It will be included in the generated OpenAPI (e.g. visible at `/docs`).
                """
            ),
        ] = None,
        description: Annotated[
            str | None,
            Doc(
                """
                Security scheme description.

                It will be included in the generated OpenAPI (e.g. visible at `/docs`).
                """
            ),
        ] = None,
        auto_error: Annotated[
            bool,
            Doc(
                """
                By default, if the cookie is not provided, `APIKeyCookie` will
                automatically cancel the request and send the client an error.

                If `auto_error` is set to `False`, when the cookie is not available,
                instead of erroring out, the dependency result will be `None`.

                This is useful when you want to have optional authentication.

                It is also useful when you want to have authentication that can be
                provided in one of multiple optional ways (for example, in a cookie or
                in an HTTP Bearer token).
                """
            ),
        ] = True,
    ):
        super().__init__(
            location=APIKeyIn.cookie,
            name=name,
            scheme_name=scheme_name,
            description=description,
            auto_error=auto_error,
        )

    async def __call__(self, request: Request) -> str | None:
        api_key = request.cookies.get(self.model.name)
        return self.check_api_key(api_key)
