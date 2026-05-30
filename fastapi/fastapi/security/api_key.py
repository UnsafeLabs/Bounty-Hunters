import math
import time
from collections.abc import Callable, Sequence
from threading import Lock
from typing import Annotated, cast

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


class APIKeyWithRateLimit(APIKeyHeader):
    """
    API key authentication using a header with optional in-memory rate limiting.

    This extends `APIKeyHeader` with a per-key sliding window limiter and
    deprecated-key warning support without changing existing API key classes.
    """

    deprecated_key_warning = '299 - "API key is deprecated and will be deactivated"'

    def __init__(
        self,
        *,
        name: Annotated[str, Doc("Header name.")],
        rate_limit: Annotated[
            str,
            Doc(
                """
                Sliding-window rate limit formatted as `<count>/<period>`, for example
                `100/minute` or `1000/hour`.
                """
            ),
        ],
        deprecated_keys: Annotated[
            Sequence[str] | None,
            Doc(
                """
                Old API keys that should still authenticate but add a Warning response
                header indicating that the key will be deactivated.
                """
            ),
        ] = None,
        max_tracked_keys: Annotated[
            int,
            Doc(
                """
                Maximum number of API key buckets retained in memory. When the limit is
                reached, expired buckets are pruned first and the oldest remaining
                bucket is evicted if necessary.
                """
            ),
        ] = 10000,
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
                By default, if the header is not provided, `APIKeyWithRateLimit` will
                automatically cancel the request and send the client an error.
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
        self.rate_limit_count, self.rate_limit_window_seconds = self._parse_rate_limit(
            rate_limit
        )
        if max_tracked_keys <= 0:
            raise ValueError("max_tracked_keys must be greater than 0")
        if isinstance(deprecated_keys, (str, bytes)):
            raise TypeError("deprecated_keys must be a sequence of strings")
        self.deprecated_keys = set(deprecated_keys or ())
        self._request_timestamps: dict[str, list[float]] = {}
        self.max_tracked_keys = max_tracked_keys
        self._lock = Lock()
        self._time_provider: Callable[[], float] = time.monotonic

    async def __call__(
        self, request: Request, response: Response = cast(Response, None)
    ) -> str | None:
        api_key = self.check_api_key(request.headers.get(self.model.name))
        if api_key is None:
            return None

        warning_headers = self._warning_headers(api_key)
        self._check_rate_limit(api_key, exception_headers=warning_headers)
        if response is not None:
            response.headers.update(warning_headers)
        return api_key

    @staticmethod
    def _parse_rate_limit(rate_limit: str) -> tuple[int, int]:
        try:
            raw_count, raw_period = rate_limit.split("/", 1)
            count = int(raw_count.strip())
        except ValueError as exc:
            raise ValueError(
                "rate_limit must be formatted as '<count>/<period>'"
            ) from exc

        if count <= 0:
            raise ValueError("rate_limit count must be greater than 0")

        periods = {
            "second": 1,
            "seconds": 1,
            "minute": 60,
            "minutes": 60,
            "hour": 3600,
            "hours": 3600,
        }
        period_seconds = periods.get(raw_period.strip().lower())
        if period_seconds is None:
            raise ValueError("rate_limit period must be one of: second, minute, hour")
        return count, period_seconds

    def _check_rate_limit(
        self, api_key: str, exception_headers: dict[str, str] | None = None
    ) -> None:
        with self._lock:
            now = self._time_provider()
            window_start = now - self.rate_limit_window_seconds
            if api_key not in self._request_timestamps:
                self._prune_or_evict_key_bucket(window_start)

            timestamps = [
                timestamp
                for timestamp in self._request_timestamps.get(api_key, [])
                if timestamp > window_start
            ]
            self._request_timestamps[api_key] = timestamps

            if len(timestamps) >= self.rate_limit_count:
                retry_after = max(
                    1,
                    math.ceil(self.rate_limit_window_seconds - (now - min(timestamps))),
                )
                headers = {"Retry-After": str(retry_after)}
                if exception_headers:
                    headers.update(exception_headers)
                raise HTTPException(
                    status_code=HTTP_429_TOO_MANY_REQUESTS,
                    detail="Rate limit exceeded",
                    headers=headers,
                )

            timestamps.append(now)

    def _warning_headers(self, api_key: str) -> dict[str, str]:
        if api_key not in self.deprecated_keys:
            return {}
        return {"Warning": self.deprecated_key_warning}

    def _prune_or_evict_key_bucket(self, window_start: float) -> None:
        if len(self._request_timestamps) < self.max_tracked_keys:
            return

        expired_keys = [
            key
            for key, timestamps in self._request_timestamps.items()
            if not any(timestamp > window_start for timestamp in timestamps)
        ]
        for key in expired_keys:
            del self._request_timestamps[key]

        if len(self._request_timestamps) < self.max_tracked_keys:
            return

        oldest_key = min(
            self._request_timestamps,
            key=lambda key: min(self._request_timestamps[key], default=window_start),
        )
        del self._request_timestamps[oldest_key]


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
