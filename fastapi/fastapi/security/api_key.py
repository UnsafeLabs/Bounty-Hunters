from __future__ import annotations

import re
import threading
import time
from collections import defaultdict
from typing import Annotated

from annotated_doc import Doc
from fastapi.openapi.models import APIKey, APIKeyIn
from fastapi.security.base import SecurityBase
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import Response
from starlette.status import HTTP_401_UNAUTHORIZED, HTTP_429_TOO_MANY_REQUESTS


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


# ---------------------------------------------------------------------------
# Rate-limit interval parsing
# ---------------------------------------------------------------------------

_INTERVAL_SECONDS: dict[str, int] = {
    "second": 1,
    "seconds": 1,
    "sec": 1,
    "s": 1,
    "minute": 60,
    "minutes": 60,
    "min": 60,
    "m": 60,
    "hour": 3600,
    "hours": 3600,
    "h": 3600,
    "day": 86400,
    "days": 86400,
    "d": 86400,
}

_RATE_LIMIT_RE = re.compile(
    r"^\s*(\d+)\s*/\s*(seconds?|minutes?|mins?|hours?|days?|[smhd])\s*$",
    re.IGNORECASE,
)


def _parse_rate_limit(rate_limit: str) -> tuple[int, int]:
    """Parse a rate limit string like ``"100/minute"`` into ``(max_requests, window_seconds)``.

    Raises ``ValueError`` for unrecognised formats.
    """
    match = _RATE_LIMIT_RE.match(rate_limit)
    if not match:
        raise ValueError(
            f"Invalid rate_limit format: {rate_limit!r}. "
            "Expected format: '<count>/<interval>' e.g. '100/minute', '1000/hour'."
        )
    count = int(match.group(1))
    interval_str = match.group(2).lower()
    window = _INTERVAL_SECONDS[interval_str]
    return count, window


# ---------------------------------------------------------------------------
# Sliding-window rate limiter (thread-safe, per-key)
# ---------------------------------------------------------------------------


class _SlidingWindowLimiter:
    """Per-key sliding window rate limiter using an in-memory dictionary.

    Thread-safe via a lock.  Old timestamps are pruned on each check to
    prevent unbounded memory growth.
    """

    def __init__(self, max_requests: int, window_seconds: int) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._requests: dict[str, list[float]] = defaultdict(list)
        self._lock = threading.Lock()

    def check(self, key: str) -> tuple[bool, int]:
        """Check whether *key* is within its rate limit.

        Returns ``(allowed, retry_after)`` where *retry_after* is the number
        of seconds until the oldest request in the window expires (or 0 if
        allowed).
        """
        now = time.monotonic()
        cutoff = now - self.window_seconds

        with self._lock:
            timestamps = self._requests[key]
            # Prune expired entries.
            self._requests[key] = timestamps = [t for t in timestamps if t > cutoff]

            if len(timestamps) >= self.max_requests:
                # Calculate retry-after from the oldest entry in the window.
                retry_after = max(1, int(timestamps[0] - cutoff) + 1)
                return False, retry_after

            timestamps.append(now)
            return True, 0


# ---------------------------------------------------------------------------
# APIKeyWithRateLimit
# ---------------------------------------------------------------------------


class APIKeyWithRateLimit(APIKeyHeader):
    """API key authentication with per-key rate limiting and deprecated key warnings.

    Extends ``APIKeyHeader`` to add:

    * **Rate limiting** — each API key is tracked independently using a sliding
      window.  When the limit is exceeded the request receives a
      ``429 Too Many Requests`` response with a ``Retry-After`` header.

    * **Deprecated key warnings** — keys listed in ``deprecated_keys``
      authenticate successfully but include an ``Warning`` header in the
      response indicating that the key will be deactivated soon.

    ## Usage

    ```python
    from fastapi import Depends, FastAPI
    from fastapi.security import APIKeyWithRateLimit

    app = FastAPI()

    api_key_scheme = APIKeyWithRateLimit(
        name="X-API-Key",
        rate_limit="100/minute",
        deprecated_keys=["old-key-1", "old-key-2"],
    )


    @app.get("/items/")
    async def read_items(api_key: str = Depends(api_key_scheme)):
        return {"api_key": api_key}
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
                Rate limit as a string like ``"100/minute"`` or ``"1000/hour"``.

                Supported intervals: ``second``/``s``, ``minute``/``min``/`m``,
                ``hour``/``h``, ``day``/``d``.
                """
            ),
        ] = "100/minute",
        deprecated_keys: Annotated[
            list[str] | None,
            Doc(
                """
                A list of old API keys that should still authenticate but include
                a ``Warning`` header in the response indicating the key will be
                deactivated soon.  Set to ``None`` (default) to disable.
                """
            ),
        ] = None,
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
                By default, if the header is not provided, ``APIKeyWithRateLimit``
                will automatically cancel the request and send the client an error.

                If ``auto_error`` is set to ``False``, when the header is not
                available, instead of erroring out, the dependency result will be
                ``None``.
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

        max_requests, window_seconds = _parse_rate_limit(rate_limit)
        self._limiter = _SlidingWindowLimiter(max_requests, window_seconds)
        self._deprecated_keys: set[str] = set(deprecated_keys) if deprecated_keys else set()

    async def __call__(self, request: Request) -> str | None:  # type: ignore[override]
        """Authenticate the request, enforce rate limits, and warn on deprecated keys.

        This method is used as a FastAPI dependency.  It returns the API key
        string on success, or ``None`` when ``auto_error=False`` and no key
        was provided.

        On rate‑limit breach the request is aborted with HTTP 429.

        For deprecated keys, the flag ``request.state.api_key_deprecated``
        is set so that :class:`~fastapi.middleware.deprecated_key_warning.DeprecatedKeyWarningMiddleware`
        can add the ``Warning`` response header.
        """
        # --- Extract the key first (delegates to the parent's check logic) ---
        api_key_raw = request.headers.get(self.model.name)

        # If no key and auto_error is off, return None immediately.
        if not api_key_raw:
            if self.auto_error:
                raise self.make_not_authenticated_error()
            return None

        api_key = api_key_raw

        # --- Rate limiting ---
        allowed, retry_after = self._limiter.check(api_key)
        if not allowed:
            raise HTTPException(
                status_code=HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded",
                headers={"Retry-After": str(retry_after)},
            )

        # --- Deprecated key warning ---
        # Flag the request so the middleware can inject the Warning header.
        if api_key in self._deprecated_keys:
            request.state.api_key_deprecated = True

        return api_key

    def is_deprecated(self, api_key: str) -> bool:
        """Return ``True`` if *api_key* is in the deprecated list."""
        return api_key in self._deprecated_keys
