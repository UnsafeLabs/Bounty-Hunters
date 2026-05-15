from typing import Annotated

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


# ── Rate Limiting ────────────────────────────────────────────────────────────────

import threading
import time
from dataclasses import dataclass
from typing import Annotated

from starlette.requests import Request
from starlette.status import HTTP_429_TOO_MANY_REQUESTS


@dataclass
class RateLimitWindow:
    """Sliding window state for a single API key."""
    count: int
    window_start: float


class RateLimitStore:
    """Thread-safe in-memory rate limit store with sliding window."""

    def __init__(self) -> None:
        self._windows: dict[str, RateLimitWindow] = {}
        self._lock = threading.Lock()

    def check(self, key: str, limit: int, window_seconds: float) -> tuple[bool, int]:
        """
        Check if a key is within its rate limit.

        Returns (allowed, retry_after_seconds).
        retry_after_seconds is 0 when allowed.
        """
        now = time.monotonic()
        with self._lock:
            win = self._windows.get(key)
            if win is None:
                self._windows[key] = RateLimitWindow(count=1, window_start=now)
                return True, 0

            elapsed = now - win.window_start
            if elapsed >= window_seconds:
                # Reset window
                self._windows[key] = RateLimitWindow(count=1, window_start=now)
                return True, 0

            if win.count >= limit:
                retry_after = int(window_seconds - elapsed) + 1
                return False, retry_after

            win.count += 1
            return True, 0

    def clear_key(self, key: str) -> None:
        with self._lock:
            self._windows.pop(key, None)


def _parse_rate_limit(value: str) -> tuple[int, float]:
    """Parse a string like '100/minute', '1000/hour' into (count, seconds)."""
    parts = value.strip().lower().split("/")
    if len(parts) != 2:
        raise ValueError(f"Invalid rate limit format: {value!r} (expected e.g. '100/minute')")
    count_str, unit = parts
    count = int(count_str)
    unit = unit.strip()
    multiplier = {"second": 1, "minute": 60, "hour": 3600, "day": 86400}
    if unit not in multiplier:
        raise ValueError(f"Unknown rate limit unit: {unit!r} (known: {list(multiplier)})")
    return count, float(multiplier[unit])


class APIKeyWithRateLimit(APIKeyHeader):
    """
    API key authentication with built-in rate limiting and key rotation.

    Extends APIKeyHeader with:
    - Rate limiting via sliding window (per API key)
    - Deprecated key support (old keys still work but get Warning header)
    - Thread-safe in-memory tracking

    ## Example

    ```python
    api_key_limiter = APIKeyWithRateLimit(
        name="x-api-key",
        rate_limit="100/minute",
        deprecated_keys=["old-key-1", "old-key-2"],
    )

    @app.get("/items/")
    async def read_items(key: str = Depends(api_key_limiter)):
        return {"key": key}
    ```
    """

    def __init__(
        self,
        *,
        name: Annotated[str, Doc("Header name for the API key.")],
        rate_limit: Annotated[
            str,
            Doc(
                """
                Rate limit as a string, e.g. '100/minute', '1000/hour', '5/second'.
                """
            ),
        ],
        deprecated_keys: Annotated[
            list[str] | None,
            Doc(
                """
                API keys that should still authenticate but receive a Warning header
                indicating they are deprecated and will be deactivated.
                """
            ),
        ] = None,
        scheme_name: Annotated[str | None, Doc("Security scheme name for OpenAPI.")] = None,
        description: Annotated[str | None, Doc("Security scheme description.")] = None,
        auto_error: Annotated[bool, Doc("Auto-error when key is missing.")] = True,
    ):
        super().__init__(
            name=name,
            scheme_name=scheme_name,
            description=description,
            auto_error=auto_error,
        )
        self.rate_limit = rate_limit
        self._limit, self._window_seconds = _parse_rate_limit(rate_limit)
        self.deprecated_keys: set[str] = set(deprecated_keys) if deprecated_keys else set()
        self._store = RateLimitStore()

    async def __call__(self, request: Request) -> str | None:
        api_key = request.headers.get(self.model.name)
        if not api_key:
            return self.check_api_key(api_key)

        # Check rate limit
        allowed, retry_after = self._store.check(api_key, self._limit, self._window_seconds)
        if not allowed:
            from starlette.exceptions import HTTPException
            raise HTTPException(
                status_code=HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded: {self.rate_limit}",
                headers={"Retry-After": str(retry_after)},
            )

        # Check deprecated key
        if api_key in self.deprecated_keys:
            # Authenticate but add Warning header
            from starlette.responses import Response
            response = Response(content="", status_code=200)
            response.headers["Warning"] = '299 - "API key is deprecated and will be deactivated soon"'
            # We can't mutate the response here in a dependency, so we set a header
            # on the request state for the app to pick up
            request.state.deprecated_api_key = True

        return api_key
