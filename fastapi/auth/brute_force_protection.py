"""Fix: Add brute force protection to HTTPBasic authentication (#800)"""

import time
import hashlib
from collections import defaultdict
from dataclasses import dataclass, field
from fastapi import Request, HTTPException

@dataclass
class AttemptRecord:
    attempts: list[float] = field(default_factory=list)
    locked_until: float = 0.0

class BruteForceProtection:
    def __init__(
        self,
        max_attempts: int = 5,
        window_seconds: int = 300,
        lockout_seconds: int = 900,
        progressive_lockout: bool = True,
    ):
        self._max_attempts = max_attempts
        self._window = window_seconds
        self._lockout = lockout_seconds
        self._progressive = progressive_lockout
        self._records: dict[str, AttemptRecord] = defaultdict(AttemptRecord)

    def _key(self, request: Request) -> str:
        ip = request.client.host if request.client else "unknown"
        return hashlib.sha256(ip.encode()).hexdigest()[:16]

    def check(self, request: Request) -> None:
        key = self._key(request)
        record = self._records[key]
        now = time.time()

        if record.locked_until and now < record.locked_until:
            remaining = int(record.locked_until - now)
            raise HTTPException(
                status_code=429,
                detail=f"Account locked. Try again in {remaining}s",
                headers={"Retry-After": str(remaining)},
            )

        # Clean old attempts
        record.attempts = [t for t in record.attempts if now - t < self._window]

    def record_failure(self, request: Request) -> None:
        key = self._key(request)
        record = self._records[key]
        now = time.time()
        record.attempts.append(now)

        if len(record.attempts) >= self._max_attempts:
            multiplier = 1
            if self._progressive and len(record.attempts) > self._max_attempts:
                multiplier = min(len(record.attempts) // self._max_attempts, 8)
            record.locked_until = now + self._lockout * multiplier

    def record_success(self, request: Request) -> None:
        key = self._key(request)
        if key in self._records:
            self._records[key].attempts.clear()
            self._records[key].locked_until = 0

    def get_status(self, request: Request) -> dict:
        key = self._key(request)
        record = self._records.get(key, AttemptRecord())
        now = time.time()
        return {
            "attempts": len([t for t in record.attempts if now - t < self._window]),
            "max_attempts": self._max_attempts,
            "locked": bool(record.locked_until and now < record.locked_until),
            "locked_until": record.locked_until if record.locked_until > now else None,
        }
