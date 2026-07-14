import time
from collections.abc import Callable
from threading import Lock
from typing import Annotated, Any

from annotated_doc import Doc
from fastapi.openapi.models import APIKey, APIKeyIn
from fastapi.security.base import SecurityBase
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.status import HTTP_401_UNAUTHORIZED


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


class _RateLimitStore:
    """Thread-safe in-memory store for API key rate limiting.

    Uses timestamp-based sliding window tracking.
    """

    def __init__(self) -> None:
        self._lock = Lock()
        self._requests: dict[str, list[float]] = {}

    def record(self, key: str) -> None:
        """Record a request timestamp for the given key."""
        now = time.time()
        with self._lock:
            if key not in self._requests:
                self._requests[key] = []
            self._requests[key].append(now)

    def count_in_window(self, key: str, window_seconds: int) -> int:
        """Count requests for the key within the sliding window."""
        now = time.time()
        cutoff = now - window_seconds
        with self._lock:
            if key not in self._requests:
                return 0
            # Prune expired timestamps
            self._requests[key] = [
                ts for ts in self._requests[key] if ts > cutoff
            ]
            return len(self._requests[key])

    def clear(self, key: str) -> None:
        """Clear all records for a key."""
        with self._lock:
            self._requests.pop(key, None)


# Global rate limit store shared across all APIKeyWithRateLimit instances
_rate_limit_store = _RateLimitStore()


class APIKeyWithRateLimit(APIKeyHeader):
    """API key authentication with built-in rate limiting and key deprecation.

    Extends APIKeyHeader with:
    - Rate limiting per API key using sliding window
    - Deprecated key detection with Warning header
    - 429 Too Many Requests with Retry-After header

    ## Usage

    ```python
    from fastapi import Depends, FastAPI
    from fastapi.security import APIKeyWithRateLimit

    app = FastAPI()

    rate_limit_scheme = APIKeyWithRateLimit(
        name="x-api-key",
        rate_limit="100/minute",
        deprecated_keys=["old-key-123"],
    )

    @app.get("/protected/")
    async def read_protected(api_key: str = Depends(rate_limit_scheme)):
        return {"api_key": api_key}
    ```
    """

    def __init__(
        self,
        *,
        name: Annotated[str, Doc("Header name.")],
        rate_limit: Annotated[
            str | None,
            Doc(
                """
                Rate limit string like \"100/minute\" or \"1000/hour\".

                Format: \"<max_requests>/<period>\" where period is one of:
                minute, hour, day.
                """
            ),
        ] = None,
        deprecated_keys: Annotated[
            list[str] | None,
            Doc(
                """
                List of deprecated API keys that should still authenticate
                but trigger a Warning header in the response.
                """
            ),
        ] = None,
        scheme_name: Annotated[
            str | None,
            Doc("Security scheme name for OpenAPI docs."),
        ] = None,
        description: Annotated[
            str | None,
            Doc("Security scheme description for OpenAPI docs."),
        ] = None,
        auto_error: Annotated[
            bool,
            Doc(
                """
                By default, if the header is not provided, APIKeyWithRateLimit will
                automatically cancel the request and send the client an error.

                If auto_error is set to False, when the header is not available,
                instead of erroring out, the dependency result will be None.
                """
            ),
        ] = True,
    ):
        super().__init__(
            name=name,
            scheme_name=scheme_name,
            description=description,
            auto_error=auto_error,
        )
        self._parsed_rate_limit: tuple[int, int] | None = None
        if rate_limit is not None:
            self._parsed_rate_limit = self._parse_rate_limit(rate_limit)
        self.deprecated_keys = deprecated_keys or []

    @staticmethod
    def _parse_rate_limit(rate_limit: str) -> tuple[int, int]:
        """Parse rate limit string into (max_requests, window_seconds)."""
        parts = rate_limit.strip().split("/")
        if len(parts) != 2:
            raise ValueError(
                f"Invalid rate_limit format: '{rate_limit}'. "
                f"Expected format: '<max>/<period>' e.g. '100/minute'"
            )
        try:
            max_req = int(parts[0])
        except ValueError:
            raise ValueError(
                f"Invalid rate_limit max value: '{parts[0]}'. Must be an integer."
            )

        period = parts[1].lower()
        period_map: dict[str, int] = {
            "second": 1,
            "seconds": 1,
            "minute": 60,
            "minutes": 60,
            "hour": 3600,
            "hours": 3600,
            "day": 86400,
            "days": 86400,
        }
        if period not in period_map:
            raise ValueError(
                f"Unknown rate limit period: '{period}'. "
                f"Valid periods: {', '.join(sorted(period_map.keys()))}"
            )
        return (max_req, period_map[period])

    async def __call__(self, request: Request) -> str | None:
        api_key: str | None = request.headers.get(self.model.name)
        result = self.check_api_key(api_key)
        if result is None:
            return None

        # Rate limiting check
        if self._parsed_rate_limit is not None:
            max_requests, window_seconds = self._parsed_rate_limit
            current_count = _rate_limit_store.count_in_window(result, window_seconds)
            if current_count >= max_requests:
                from starlette.responses import Response  # Local import to avoid circular

                retry_after = window_seconds
                response = Response(
                    status_code=429,
                    headers={
                        "Retry-After": str(retry_after),
                        "X-RateLimit-Limit": str(max_requests),
                        "X-RateLimit-Remaining": "0",
                    },
                )
                raise HTTPException(
                    status_code=429,
                    detail="Rate limit exceeded. Try again later.",
                    headers=response.headers,
                )

        # Record this request
        if self._parsed_rate_limit is not None:
            _rate_limit_store.record(result)

        # Deprecated key check — set Warning header on request state
        if result in self.deprecated_keys:
            # Store warning flag for middleware to pick up
            if not hasattr(request.state, "_api_key_warnings"):
                request.state._api_key_warnings = []
            request.state._api_key_warnings.append(
                f'299 - "API key is deprecated and will be deactivated soon"'
            )

        return result
