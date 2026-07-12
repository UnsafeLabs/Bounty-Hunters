"""API key security schemes with optional rate limiting and key rotation."""
from __future__ import annotations

import re
import threading
import time
from collections import defaultdict, deque
from typing import Deque, Dict, List, Optional, Tuple

from fastapi import HTTPException, Request
from fastapi.security.api_key import APIKeyHeader
from starlette.responses import Response
from starlette.status import HTTP_403_FORBIDDEN, HTTP_429_TOO_MANY_REQUESTS

_WINDOW_SECONDS = {
    "second": 1,
    "minute": 60,
    "hour": 3600,
    "day": 86400,
}

DEPRECATION_WARNING = '299 - "Deprecated API key; this key will be deactivated"'


def parse_rate_limit(rate_limit: str) -> Tuple[int, int]:
    """Parse '100/minute' -> (max_requests, window_seconds)."""
    match = re.match(
        r"^(\d+)\s*/\s*(second|minute|hour|day)s?$",
        rate_limit.strip().lower(),
    )
    if not match:
        raise ValueError(
            f"Invalid rate_limit format: {rate_limit!r}. "
            "Expected e.g. '100/minute' or '1000/hour'."
        )
    return int(match.group(1)), _WINDOW_SECONDS[match.group(2)]


class APIKeyWithRateLimit(APIKeyHeader):
    """APIKeyHeader + per-key sliding-window rate limit and deprecated key warnings."""

    def __init__(
        self,
        *,
        name: str,
        scheme_name: Optional[str] = None,
        description: Optional[str] = None,
        auto_error: bool = True,
        rate_limit: str = "100/minute",
        deprecated_keys: Optional[List[str]] = None,
    ) -> None:
        super().__init__(
            name=name,
            scheme_name=scheme_name,
            description=description,
            auto_error=auto_error,
        )
        self.max_requests, self.window_seconds = parse_rate_limit(rate_limit)
        self.rate_limit = rate_limit
        self.deprecated_keys = set(deprecated_keys or [])
        self._requests: Dict[str, Deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def _check_rate_limit(self, api_key: str) -> Optional[int]:
        """Return Retry-After seconds if over limit, else record request and return None."""
        now = time.time()
        window_start = now - self.window_seconds
        with self._lock:
            q = self._requests[api_key]
            while q and q[0] <= window_start:
                q.popleft()
            if len(q) >= self.max_requests:
                retry_after = max(1, int(q[0] + self.window_seconds - now) + 1)
                return retry_after
            q.append(now)
            return None

    def reset_store(self) -> None:
        """Clear in-memory counters (tests / maintenance)."""
        with self._lock:
            self._requests.clear()

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

        retry_after = self._check_rate_limit(api_key)
        if retry_after is not None:
            raise HTTPException(
                status_code=HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded",
                headers={"Retry-After": str(retry_after)},
            )

        if api_key in self.deprecated_keys:
            response.headers["Warning"] = DEPRECATION_WARNING

        return api_key
