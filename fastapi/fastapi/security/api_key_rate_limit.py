"""API key auth with sliding-window rate limits and key deprecation warnings."""
from __future__ import annotations

import threading
import time
from typing import Dict, List, Optional, Tuple

from fastapi.security.api_key import APIKeyHeader
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import Response
from starlette.status import HTTP_403_FORBIDDEN, HTTP_429_TOO_MANY_REQUESTS

_PERIODS = {
    "second": 1,
    "seconds": 1,
    "minute": 60,
    "minutes": 60,
    "hour": 3600,
    "hours": 3600,
    "day": 86400,
    "days": 86400,
}


class APIKeyWithRateLimit(APIKeyHeader):
    """APIKeyHeader with per-key rate limiting and optional deprecated keys."""

    def __init__(
        self,
        *,
        name: str,
        rate_limit: str = "100/minute",
        deprecated_keys: Optional[List[str]] = None,
        scheme_name: Optional[str] = None,
        description: Optional[str] = None,
        auto_error: bool = True,
    ) -> None:
        super().__init__(
            name=name,
            scheme_name=scheme_name,
            description=description,
            auto_error=auto_error,
        )
        self.rate_limit = rate_limit
        self.deprecated_keys = set(deprecated_keys or [])
        self._limit, self._window = self._parse_rate_limit(rate_limit)
        self._requests: Dict[str, List[float]] = {}
        self._lock = threading.Lock()

    @staticmethod
    def _parse_rate_limit(rate_limit: str) -> Tuple[int, int]:
        parts = rate_limit.strip().split("/")
        if len(parts) != 2:
            raise ValueError(f"Invalid rate_limit format: {rate_limit!r}")
        count = int(parts[0].strip())
        period = parts[1].strip().lower()
        if period not in _PERIODS:
            raise ValueError(f"Unsupported rate limit period: {period!r}")
        if count < 1:
            raise ValueError("rate_limit count must be >= 1")
        return count, _PERIODS[period]

    def _check_rate_limit(self, api_key: str) -> None:
        now = time.time()
        with self._lock:
            timestamps = self._requests.get(api_key, [])
            cutoff = now - self._window
            timestamps = [t for t in timestamps if t > cutoff]
            if len(timestamps) >= self._limit:
                oldest = min(timestamps)
                retry_after = max(int(self._window - (now - oldest)) + 1, 1)
                self._requests[api_key] = timestamps
                raise HTTPException(
                    status_code=HTTP_429_TOO_MANY_REQUESTS,
                    detail="Rate limit exceeded",
                    headers={"Retry-After": str(retry_after)},
                )
            timestamps.append(now)
            self._requests[api_key] = timestamps

    async def __call__(
        self, request: Request, response: Response
    ) -> Optional[str]:
        api_key: Optional[str] = request.headers.get(self.model.name)
        if not api_key:
            if self.auto_error:
                raise HTTPException(
                    status_code=HTTP_403_FORBIDDEN, detail="Not authenticated"
                )
            return None

        self._check_rate_limit(api_key)

        if api_key in self.deprecated_keys:
            response.headers["Warning"] = (
                '299 - "API key is deprecated and will be deactivated"'
            )

        return api_key
