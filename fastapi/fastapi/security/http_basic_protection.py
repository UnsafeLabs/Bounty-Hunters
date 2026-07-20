"""HTTP Basic auth with brute-force protection (issue #800)."""

from __future__ import annotations

import hashlib
import hmac
import threading
import time
from collections import defaultdict, deque
from typing import Deque, Dict, Optional, Tuple


class AttemptStore:
    """Thread-safe per-IP failed attempt window."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._fails: Dict[str, Deque[float]] = defaultdict(deque)

    def register_failure(self, ip: str, now: Optional[float] = None, window: float = 300.0) -> int:
        now = time.time() if now is None else now
        with self._lock:
            q = self._fails[ip]
            q.append(now)
            self._prune(q, now, window)
            return len(q)

    def reset(self, ip: str) -> None:
        with self._lock:
            self._fails.pop(ip, None)

    def count(self, ip: str, now: Optional[float] = None, window: float = 300.0) -> int:
        now = time.time() if now is None else now
        with self._lock:
            q = self._fails[ip]
            self._prune(q, now, window)
            return len(q)

    def retry_after(self, ip: str, now: Optional[float] = None, window: float = 300.0) -> int:
        now = time.time() if now is None else now
        with self._lock:
            q = self._fails[ip]
            self._prune(q, now, window)
            if not q:
                return 0
            oldest = q[0]
            return max(1, int(window - (now - oldest)) + 1)

    @staticmethod
    def _prune(q: Deque[float], now: float, window: float) -> None:
        cutoff = now - window
        while q and q[0] <= cutoff:
            q.popleft()


class HTTPBasicWithProtection:
    """
    HTTP Basic wrapper adding per-IP attempt limits and timing-safe password verify.

    Existing HTTPBasic behavior remains available unchanged in http.py.
    """

    def __init__(
        self,
        max_attempts: int = 5,
        window_seconds: float = 300.0,
        realm: str = "Protected",
    ) -> None:
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self.realm = realm
        self.store = AttemptStore()

    def check_lockout(self, ip: str, now: Optional[float] = None) -> Optional[int]:
        """Return Retry-After seconds if locked out, else None."""
        count = self.store.count(ip, now=now, window=self.window_seconds)
        if count >= self.max_attempts:
            return self.store.retry_after(ip, now=now, window=self.window_seconds)
        return None

    def register_failure(self, ip: str, now: Optional[float] = None) -> Optional[int]:
        self.store.register_failure(ip, now=now, window=self.window_seconds)
        return self.check_lockout(ip, now=now)

    def register_success(self, ip: str) -> None:
        self.store.reset(ip)

    @staticmethod
    def verify_password(plain: str, expected: str) -> bool:
        """Timing-safe comparison (constant-time) of password strings."""
        a = plain.encode("utf-8")
        b = expected.encode("utf-8")
        # hash both to equalize length for compare_digest when lengths differ
        ha = hashlib.sha256(a).digest()
        hb = hashlib.sha256(b).digest()
        return hmac.compare_digest(ha, hb) and hmac.compare_digest(
            hashlib.sha256(a + b"\0").digest(),
            hashlib.sha256(b + b"\0").digest(),
        ) and len(a) == len(b) and hmac.compare_digest(a, b)

    @staticmethod
    def verify_password_hash(plain: str, password_hash: str, salt: str = "") -> bool:
        """Verify against sha256(salt+plain) hex digest with compare_digest."""
        dig = hashlib.sha256((salt + plain).encode("utf-8")).hexdigest()
        return hmac.compare_digest(dig, password_hash)
