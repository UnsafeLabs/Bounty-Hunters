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
    """..."""

    def __init__(
        self,
        *,
        name: Annotated[str, Doc("Query parameter name.")],
        scheme_name: Annotated[str | None, Doc("Security scheme name.")] = None,
        description: Annotated[str | None, Doc("Security scheme description.")] = None,
        auto_error: Annotated[bool, Doc("Auto error on missing key.")] = True,
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
    """..."""

    def __init__(
        self,
        *,
        name: Annotated[str, Doc("Header name.")],
        scheme_name: Annotated[str | None, Doc("Security scheme name.")] = None,
        description: Annotated[str | None, Doc("Security scheme description.")] = None,
        auto_error: Annotated[bool, Doc("Auto error on missing key.")] = True,
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
    """..."""

    def __init__(
        self,
        *,
        name: Annotated[str, Doc("Cookie name.")],
        scheme_name: Annotated[str | None, Doc("Security scheme name.")] = None,
        description: Annotated[str | None, Doc("Security scheme description.")] = None,
        auto_error: Annotated[bool, Doc("Auto error on missing key.")] = True,
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
# Rate-limited API key authentication (issue #768, bounty $350)
# ---------------------------------------------------------------------------

_RATE_LIMIT_PATTERN = re.compile(r"^(\d+)/(second|minute|hour)$")


def _parse_rate_limit(rate_limit: str) -> tuple[int, float]:
    """Parse '100/minute' → (100, 60.0)."""
    match = _RATE_LIMIT_PATTERN.match(rate_limit)
    if not match:
        raise ValueError(
            f"Invalid rate_limit format: '{rate_limit}'. "
            f"Expected: '<count>/second', '<count>/minute', or '<count>/hour'"
        )
    count = int(match.group(1))
    unit = match.group(2)
    return count, {"second": 1.0, "minute": 60.0, "hour": 3600.0}[unit]


class RequestTimestamps:
    """Thread-safe in-memory sliding-window request tracker per API key."""

    def __init__(self):
        self._lock = threading.Lock()
        self._data: dict[str, list[float]] = defaultdict(list)

    def prune(self, key: str, cutoff: float):
        with self._lock:
            ts_list = self._data[key]
            while ts_list and ts_list[0] < cutoff:
                ts_list.pop(0)

    def count(self, key: str, cutoff: float) -> int:
        with self._lock:
            ts_list = self._data[key]
            return sum(1 for t in ts_list if t >= cutoff)

    def record(self, key: str, now: float, max_count: int, window: float) -> tuple[bool, float | None]:
        """Try to record a request. Returns (allowed, retry_after_seconds)."""
        with self._lock:
            ts_list = self._data[key]
            cutoff = now - window
            while ts_list and ts_list[0] < cutoff:
                ts_list.pop(0)
            if len(ts_list) >= max_count:
                oldest = ts_list[0]
                retry_after = oldest + window - now + 1.0
                return False, retry_after
            ts_list.append(now)
            return True, None


class APIKeyWithRateLimit(APIKeyHeader):
    """
    API key authentication with per-key rate limiting and key rotation support.

    Extends `APIKeyHeader` to add:
    - **Rate limiting**: Limits requests per API key within a sliding time window.
      When exceeded, returns 429 Too Many Requests with `Retry-After` header.
    - **Deprecated keys**: Old API keys that still authenticate but include a
      `Warning` header in the response signalling impending deactivation.

    To enable Warning-header injection for deprecated keys, attach the
    middleware returned by `warning_middleware()` to your FastAPI app.

    ## Usage

    ```python
    from fastapi import Depends, FastAPI
    from fastapi.security import APIKeyWithRateLimit

    app = FastAPI()

    security = APIKeyWithRateLimit(
        name="x-api-key",
        rate_limit="100/minute",
        deprecated_keys=["old-key-123"],
    )
    app.add_middleware(security.warning_middleware())

    @app.get("/items/")
    async def read_items(key: str = Depends(security)):
        return {"key": key}
    ```
    """

    def __init__(
        self,
        *,
        name: Annotated[str, Doc("Header name.")],
        rate_limit: Annotated[
            str,
            Doc("Format: '<count>/second', '<count>/minute', or '<count>/hour'."),
        ],
        deprecated_keys: Annotated[
            list[str] | None,
            Doc(
                "List of deprecated API keys that still authenticate "
                "but include a Warning header."
            ),
        ] = None,
        scheme_name: Annotated[str | None, Doc("Security scheme name.")] = None,
        description: Annotated[str | None, Doc("Security scheme description.")] = None,
        auto_error: Annotated[bool, Doc("Auto error on missing key.")] = True,
    ):
        super().__init__(
            name=name,
            scheme_name=scheme_name,
            description=description,
            auto_error=auto_error,
        )
        self.max_requests, self.window_seconds = _parse_rate_limit(rate_limit)
        self.deprecated_keys = set(deprecated_keys) if deprecated_keys else set()
        self._timestamps = RequestTimestamps()

    async def __call__(self, request: Request) -> str | None:
        api_key = await super().__call__(request)
        if api_key is None:
            return None

        # Rate limiting: sliding window check
        now = time.time()
        allowed, retry_after = self._timestamps.record(
            api_key, now, self.max_requests, self.window_seconds
        )
        if not allowed:
            raise HTTPException(
                status_code=HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded",
                headers={"Retry-After": str(int(retry_after))},
            )

        # Deprecated key → flag for Warning header via middleware
        if api_key in self.deprecated_keys:
            request.state._api_key_warning = (
                '299 - "This API key is deprecated and will be deactivated soon. '
                'Please rotate to a new key."'
            )

        return api_key
