from typing import Annotated, Dict, List, Tuple
import time
import threading

from annotated_doc import Doc
from fastapi.openapi.models import APIKey, APIKeyIn
from fastapi.security.base import SecurityBase
from starlette.exceptions import HTTPException
from starlette.requests import Request
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
            **{"in": location},  # type: ignore[arg-type]
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


class APIKeyWithRateLimit(APIKeyBase):
    def __init__(
        self,
        name: str,
        rate_limit: str,
        deprecated_keys: List[str] = None,
        scheme_name: str | None = None,
        description: str | None = None,
        auto_error: bool = True,
    ):
        super().__init__(APIKeyIn.header, name, description, scheme_name, auto_error)
        self.rate_limit = self._parse_rate_limit(rate_limit)
        self.deprecated_keys = set(deprecated_keys or [])
        self.store: Dict[str, List[float]] = {}
        self.lock = threading.Lock()

    def _parse_rate_limit(self, rate_limit: str) -> Tuple[int, int]:
        count, unit = rate_limit.split('/')
        seconds = 60 if "minute" in unit else 3600
        return int(count), seconds

    async def __call__(self, request: Request) -> str | None:
        api_key = request.headers.get(self.model.name)
        if not api_key and self.auto_error:
            raise self.make_not_authenticated_error()

        if api_key:
            limit, window = self.rate_limit
            now = time.time()
            with self.lock:
                timestamps = [t for t in self.store.get(api_key, []) if now - t < window]
                if len(timestamps) >= limit:
                    retry_after = int(window - (now - timestamps[0]))
                    raise HTTPException(
                        status_code=HTTP_429_TOO_MANY_REQUESTS,
                        detail="Too many requests",
                        headers={"Retry-After": str(retry_after)},
                    )
                timestamps.append(now)
                self.store[api_key] = timestamps

        # Prepare response headers for deprecated keys (handled via middleware/response process)
        # Note: In a real FastAPI app, this logic is usually handled in the route or middleware.
        return api_key
