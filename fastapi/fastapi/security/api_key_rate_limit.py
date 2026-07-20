"""API key authentication with sliding-window rate limits and key rotation (issue #768)."""

from __future__ import annotations

import re
import threading
import time
from collections import defaultdict, deque
from typing import Deque, Dict, Iterable, List, Optional, Tuple

from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import Response
from starlette.status import HTTP_401_UNAUTHORIZED, HTTP_429_TOO_MANY_REQUESTS

try:
    from fastapi.security.api_key import APIKeyHeader
except Exception:  # pragma: no cover — unit tests may stub
    APIKeyHeader = object  # type: ignore


_RATE_RE = re.compile(r"^\s*(\d+)\s*/\s*(second|minute|hour|day)s?\s*$", re.I)

_WINDOW_SECONDS = {
    "second": 1,
    "minute": 60,
    "hour": 3600,
    "day": 86400,
}


def parse_rate_limit(rate_limit: str) -> Tuple[int, int]:
    """Return (max_requests, window_seconds) from strings like '100/minute'."""
    m = _RATE_RE.match(rate_limit or "")
    if not m:
        raise ValueError(
            f"Invalid rate_limit {rate_limit!r}; expected e.g. '100/minute' or '1000/hour'"
        )
    count = int(m.group(1))
    unit = m.group(2).lower()
    if count < 1:
        raise ValueError("rate_limit count must be >= 1")
    return count, _WINDOW_SECONDS[unit]


class SlidingWindowCounter:
    """Thread-safe per-key sliding window of request timestamps."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._events: Dict[str, Deque[float]] = defaultdict(deque)

    def hit(self, key: str, now: Optional[float] = None, window_seconds: int = 60) -> Tuple[int, float]:
        """
        Record a hit. Returns (count_in_window_including_this, oldest_timestamp_in_window).
        """
        now = time.time() if now is None else now
        cutoff = now - window_seconds
        with self._lock:
            q = self._events[key]
            while q and q[0] <= cutoff:
                q.popleft()
            q.append(now)
            oldest = q[0] if q else now
            return len(q), oldest

    def peek(self, key: str, now: Optional[float] = None, window_seconds: int = 60) -> int:
        now = time.time() if now is None else now
        cutoff = now - window_seconds
        with self._lock:
            q = self._events[key]
            while q and q[0] <= cutoff:
                q.popleft()
            return len(q)


class APIKeyWithRateLimit(APIKeyHeader):
    """
    APIKeyHeader with per-key sliding-window rate limiting and optional deprecated keys.

    Parameters
    ----------
    rate_limit:
        e.g. \"100/minute\", \"1000/hour\"
    deprecated_keys:
        keys that still authenticate but attach a Warning header
    """

    def __init__(
        self,
        *,
        name: str = "X-API-Key",
        rate_limit: str = "100/minute",
        deprecated_keys: Optional[Iterable[str]] = None,
        scheme_name: Optional[str] = None,
        description: Optional[str] = None,
        auto_error: bool = True,
        valid_keys: Optional[Iterable[str]] = None,
    ) -> None:
        # Call parent if available
        try:
            super().__init__(
                name=name,
                scheme_name=scheme_name,
                description=description,
                auto_error=auto_error,
            )
        except TypeError:
            self.model = type("M", (), {"name": name})()
            self.auto_error = auto_error
            self.scheme_name = scheme_name or "APIKeyWithRateLimit"

        self.max_requests, self.window_seconds = parse_rate_limit(rate_limit)
        self.rate_limit = rate_limit
        self.deprecated_keys = set(deprecated_keys or [])
        self.valid_keys = set(valid_keys) if valid_keys is not None else None
        self._counter = SlidingWindowCounter()

    def check_rate_limit(self, api_key: str, now: Optional[float] = None) -> Optional[int]:
        """
        Record a request for api_key. Returns Retry-After seconds if limited, else None.
        """
        count, oldest = self._counter.hit(
            api_key, now=now, window_seconds=self.window_seconds
        )
        if count > self.max_requests:
            now = time.time() if now is None else now
            retry_after = max(1, int(self.window_seconds - (now - oldest)) + 1)
            return retry_after
        return None

    def is_deprecated(self, api_key: str) -> bool:
        return api_key in self.deprecated_keys

    async def __call__(self, request: Request) -> Optional[str]:
        api_key = request.headers.get(self.model.name)
        if not api_key:
            if getattr(self, "auto_error", True):
                raise HTTPException(
                    status_code=HTTP_401_UNAUTHORIZED,
                    detail="Not authenticated",
                    headers={"WWW-Authenticate": "APIKey"},
                )
            return None

        if self.valid_keys is not None and api_key not in self.valid_keys and api_key not in self.deprecated_keys:
            if getattr(self, "auto_error", True):
                raise HTTPException(
                    status_code=HTTP_401_UNAUTHORIZED,
                    detail="Invalid API key",
                    headers={"WWW-Authenticate": "APIKey"},
                )
            return None

        retry_after = self.check_rate_limit(api_key)
        if retry_after is not None:
            raise HTTPException(
                status_code=HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded",
                headers={"Retry-After": str(retry_after)},
            )

        # Stash deprecation warning for middleware/route to attach if needed
        if self.is_deprecated(api_key):
            request.state.api_key_warning = (
                '299 - "Deprecated API key; rotate to a new key before deactivation"'
            )

        return api_key

    def apply_warning_header(self, response: Response, api_key: str) -> None:
        if self.is_deprecated(api_key):
            response.headers["Warning"] = (
                '299 - "Deprecated API key; rotate to a new key before deactivation"'
            )
