import time
from threading import Lock
from typing import Annotated

from annotated_doc import Doc
from fastapi.exceptions import HTTPException
from starlette.status import HTTP_429_TOO_MANY_REQUESTS


class BruteForceProtector:
    def __init__(
        self,
        *,
        max_attempts: Annotated[
            int,
            Doc("Number of failed attempts before lockout."),
        ] = 5,
        base_lockout_seconds: Annotated[
            float,
            Doc("Initial lockout duration in seconds."),
        ] = 30.0,
        max_lockout_seconds: Annotated[
            float,
            Doc("Maximum lockout duration in seconds (cap for exponential backoff)."),
        ] = 3600.0,
    ) -> None:
        if max_attempts < 1:
            raise ValueError("max_attempts must be >= 1")
        if base_lockout_seconds <= 0:
            raise ValueError("base_lockout_seconds must be > 0")
        if max_lockout_seconds < base_lockout_seconds:
            raise ValueError("max_lockout_seconds must be >= base_lockout_seconds")

        self.max_attempts = max_attempts
        self.base_lockout_seconds = base_lockout_seconds
        self.max_lockout_seconds = max_lockout_seconds

        self._lock = Lock()
        self._failures: dict[str, int] = {}
        self._lockout_until: dict[str, float] = {}
        self._lockout_level: dict[str, int] = {}

    def _is_locked_out(self, key: str, now: float) -> bool:
        locked_until = self._lockout_until.get(key, 0)
        return now < locked_until

    def _retry_after(self, key: str, now: float) -> int:
        locked_until = self._lockout_until.get(key, 0)
        remaining = locked_until - now
        return max(1, int(remaining) + 1)

    def check(self, key: str) -> HTTPException | None:
        now = time.monotonic()
        with self._lock:
            if self._is_locked_out(key, now):
                retry_after = self._retry_after(key, now)
                return HTTPException(
                    status_code=HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many failed login attempts. Please try again later.",
                    headers={"Retry-After": str(retry_after)},
                )
        return None

    def record_failure(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            if self._is_locked_out(key, now):
                return

            failures = self._failures.get(key, 0) + 1
            self._failures[key] = failures

            if failures >= self.max_attempts:
                level = self._lockout_level.get(key, 0) + 1
                self._lockout_level[key] = level
                lockout = min(
                    self.base_lockout_seconds * (2 ** (level - 1)),
                    self.max_lockout_seconds,
                )
                self._lockout_until[key] = now + lockout
                self._failures[key] = 0

    def record_success(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)
            self._lockout_level.pop(key, None)
            self._lockout_until.pop(key, None)
