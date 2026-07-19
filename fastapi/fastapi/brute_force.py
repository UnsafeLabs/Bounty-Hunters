import time
from collections import defaultdict
from typing import Any

from fastapi import Request, Response
from fastapi.responses import JSONResponse


class BruteForceProtection:
    """Brute force protection middleware for HTTPBasic authentication."""

    def __init__(
        self,
        max_attempts: int = 5,
        lockout_duration: float = 300.0,
        window: float = 60.0,
    ) -> None:
        self.max_attempts = max_attempts
        self.lockout_duration = lockout_duration
        self.window = window
        self._attempts: dict[str, list[float]] = defaultdict(list)
        self._locked: dict[str, float] = {}

    def is_locked(self, ip: str) -> bool:
        locked_at = self._locked.get(ip)
        if locked_at and time.time() - locked_at < self.lockout_duration:
            return True
        if locked_at:
            del self._locked[ip]
        return False

    def record_failure(self, ip: str) -> None:
        now = time.time()
        attempts = [t for t in self._attempts[ip] if now - t < self.window]
        attempts.append(now)
        self._attempts[ip] = attempts

        if len(attempts) >= self.max_attempts:
            self._locked[ip] = now
            self._attempts[ip] = []

    def record_success(self, ip: str) -> None:
        self._attempts.pop(ip, None)
        self._locked.pop(ip, None)

    def remaining_attempts(self, ip: str) -> int:
        now = time.time()
        attempts = [t for t in self._attempts[ip] if now - t < self.window]
        return max(0, self.max_attempts - len(attempts))

    def middleware(self, request: Request, call_next: Any) -> Response:
        client_ip = request.client.host if request.client else "unknown"

        if self.is_locked(client_ip):
            return JSONResponse(
                status_code=429,
                content={
                    "detail": "Too many failed attempts. Please try again later.",
                    "retry_after": int(self.lockout_duration - (time.time() - self._locked.get(client_ip, 0))),
                },
            )

        response = call_next(request)

        if response.status_code == 401:
            self.record_failure(client_ip)
            remaining = self.remaining_attempts(client_ip)
            response.headers["X-RateLimit-Remaining"] = str(remaining)
        elif response.status_code == 200:
            self.record_success(client_ip)

        return response
