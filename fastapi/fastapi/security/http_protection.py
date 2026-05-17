import hashlib
import hmac
import time
from collections import defaultdict

from starlette.requests import Request
from starlette.exceptions import HTTPException
from starlette.status import HTTP_429_TOO_MANY_REQUESTS

from .http import HTTPBasic, HTTPBasicCredentials


class HTTPBasicWithProtection(HTTPBasic):
    """HTTPBasic with brute force protection and password verification."""

    _attempts: dict[str, list[float]] = defaultdict(list)

    def __init__(
        self,
        *,
        scheme_name: str | None = None,
        description: str | None = None,
        auto_error: bool = True,
        max_attempts: int = 5,
        window_seconds: float = 300.0,
    ):
        super().__init__(
            scheme_name=scheme_name,
            description=description,
            auto_error=auto_error,
        )
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds

    def _get_client_ip(self, request: Request) -> str:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        client = getattr(request, "client", None)
        if client:
            return client.host if hasattr(client, "host") else str(client)
        return "unknown"

    def _check_rate_limit(self, ip: str) -> tuple[bool, int]:
        """Check if IP is rate limited. Returns (blocked, retry_after_seconds)."""
        now = time.time()
        self._attempts[ip] = [t for t in self._attempts[ip] if now - t < self.window_seconds]
        if len(self._attempts[ip]) >= self.max_attempts:
            oldest = min(self._attempts[ip])
            retry_after = int(self.window_seconds - (now - oldest))
            return True, max(1, retry_after)
        return False, 0

    def _record_attempt(self, ip: str) -> None:
        self._attempts[ip].append(time.time())

    def _reset_attempts(self, ip: str) -> None:
        self._attempts.pop(ip, None)

    @staticmethod
    def verify_password(plain_password: str, hashed_password: str) -> bool:
        """Constant-time password comparison."""
        return hmac.compare_digest(
            hashlib.sha256(plain_password.encode()).hexdigest(),
            hashed_password,
        )

    async def __call__(
        self, request: Request
    ) -> HTTPBasicCredentials | None:
        ip = self._get_client_ip(request)
        blocked, retry_after = self._check_rate_limit(ip)
        if blocked:
            raise HTTPException(
                status_code=429,
                detail="Too many login attempts. Try again later.",
                headers={"Retry-After": str(retry_after)},
            )

        try:
            credentials = await super().__call__(request)
        except HTTPException:
            self._record_attempt(ip)
            raise

        if credentials is not None:
            self._reset_attempts(ip)
        return credentials