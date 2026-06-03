import threading
import time
from collections import defaultdict, deque
from typing import Annotated, Dict, List, Optional, Tuple

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


def _parse_rate_limit(rate_limit: str) -> Tuple[int, int]:
    """Parse a rate limit string like '100/minute' into (count, window_seconds).

    Supported units: second, minute, hour, day.
    """
    parts = rate_limit.split("/")
    if len(parts) != 2:
        raise ValueError(
            f"Invalid rate limit format: '{rate_limit}'. "
            "Expected format: '<count>/<unit>', e.g. '100/minute'"
        )
    try:
        count = int(parts[0])
    except ValueError:
        raise ValueError(f"Invalid rate limit count: '{parts[0]}'")
    unit = parts[1].strip().lower()
    unit_map = {
        "second": 1, "seconds": 1,
        "minute": 60, "minutes": 60,
        "hour": 3600, "hours": 3600,
        "day": 86400, "days": 86400,
    }
    if unit not in unit_map:
        raise ValueError(
            f"Unknown rate limit unit: '{unit}'. "
            "Supported: second, minute, hour, day"
        )
    return count, unit_map[unit]


class APIKeyWithRateLimit(APIKeyHeader):
    """
    API key authentication with rate limiting and key deprecation support.

    Extends `APIKeyHeader` to add:
    - In-memory sliding window rate limiting per API key
    - Deprecated key support — old keys still authenticate but responses
      include a `Warning` header

    ## Usage

    ```python
    from fastapi import Depends, FastAPI
    from fastapi.security import APIKeyWithRateLimit

    app = FastAPI()

    auth_scheme = APIKeyWithRateLimit(
        name="x-api-key",
        rate_limit="100/minute",
        deprecated_keys=["old-key-1", "old-key-2"],
    )

    @app.get("/items/")
    async def read_items(api_key: str = Depends(auth_scheme)):
        return {"api_key": api_key}


    # Optional: forward Warning headers from request.state to the response
    @app.middleware("http")
    async def forward_warning_header(request, call_next):
        response = await call_next(request)
        if hasattr(request.state, "warning_header") and request.state.warning_header:
            response.headers["Warning"] = request.state.warning_header
        return response
    ```

    When the rate limit is exceeded, the client receives a `429 Too Many Requests`
    response with a `Retry-After` header indicating the number of seconds to wait.

    When a deprecated API key is used, the request succeeds but a `Warning` header
    is stored in `request.state.warning_header`. Add the middleware above to
    forward it to the HTTP response.
    """

    _rate_tracker: Dict[str, deque] = defaultdict(deque)
    _lock = threading.Lock()

    def __init__(
        self,
        *,
        name: Annotated[str, Doc("Header name.")],
        rate_limit: Annotated[
            str,
            Doc(
                "Rate limit string. Examples: '100/minute', '1000/hour', '5/second'."
            ),
        ],
        deprecated_keys: Annotated[
            Optional[List[str]],
            Doc(
                "List of old API keys that should still authenticate but "
                "trigger a Warning header indicating upcoming deactivation."
            ),
        ] = None,
        scheme_name: Annotated[
            str | None,
            Doc(
                "Security scheme name. "
                "It will be included in the generated OpenAPI (e.g. visible at `/docs`)."
            ),
        ] = None,
        description: Annotated[
            str | None,
            Doc(
                "Security scheme description. "
                "It will be included in the generated OpenAPI (e.g. visible at `/docs`)."
            ),
        ] = None,
        auto_error: Annotated[
            bool,
            Doc(
                "By default, if the header is not provided, `APIKeyWithRateLimit` will "
                "automatically cancel the request and send the client an error. "
                "If `auto_error` is set to `False`, when the header is not available, "
                "the dependency result will be `None`."
            ),
        ] = True,
    ):
        super().__init__(
            name=name,
            scheme_name=scheme_name,
            description=description,
            auto_error=auto_error,
        )
        self.rate_limit_count, self.rate_limit_window = _parse_rate_limit(rate_limit)
        self.deprecated_keys = set(deprecated_keys or [])

    async def __call__(self, request: Request) -> str | None:
        api_key = request.headers.get(self.model.name)
        api_key = self.check_api_key(api_key)

        if api_key is None:
            return None

        # --- Rate limiting: sliding window ---
        now = time.time()
        window_start = now - self.rate_limit_window
        key_timestamps = self._rate_tracker[api_key]

        with self._lock:
            # Prune expired timestamps
            while key_timestamps and key_timestamps[0] < window_start:
                key_timestamps.popleft()

            # Enforce limit
            if len(key_timestamps) >= self.rate_limit_count:
                retry_after = int(
                    key_timestamps[0] + self.rate_limit_window - now
                )
                raise HTTPException(
                    status_code=429,
                    detail="Too Many Requests",
                    headers={"Retry-After": str(max(1, retry_after))},
                )

            key_timestamps.append(now)

        # --- Deprecated key warning ---
        if api_key in self.deprecated_keys:
            request.state.warning_header = (
                '299 - "The API key is deprecated and will be deactivated soon"'
            )

        return api_key
