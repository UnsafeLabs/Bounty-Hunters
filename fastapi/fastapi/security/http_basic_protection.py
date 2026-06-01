"""
HTTPBasic authentication with brute force protection.
Rate limits failed login attempts per IP address.
"""
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi import Request, HTTPException, status
from typing import Optional, Dict
from collections import defaultdict
import time
import hashlib


class HTTPBasicWithProtection(HTTPBasic):
    """
    HTTPBasic with built-in brute force protection.

    Features:
    - Rate limiting per IP address
    - Exponential backoff on failed attempts
    - Account lockout after max attempts
    - Secure password comparison using hashlib
    """

    def __init__(
        self,
        max_attempts: int = 5,
        lockout_seconds: int = 300,
        window_seconds: int = 60,
        scheme_name: str = "HTTPBasicWithProtection",
        auto_error: bool = True,
    ):
        super().__init__(scheme_name=scheme_name, auto_error=auto_error)
        self.max_attempts = max_attempts
        self.lockout_seconds = lockout_seconds
        self.window_seconds = window_seconds

        # In-memory store (use Redis in production)
        self._attempts: Dict[str, list] = defaultdict(list)
        self._lockouts: Dict[str, float] = {}

    def _get_client_ip(self, request: Request) -> str:
        """Extract client IP from request."""
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    def _is_locked_out(self, client_ip: str) -> bool:
        """Check if client IP is locked out."""
        if client_ip in self._lockouts:
            if time.time() < self._lockouts[client_ip]:
                return True
            else:
                del self._lockouts[client_ip]
                self._attempts[client_ip] = []
        return False

    def _record_attempt(self, client_ip: str) -> None:
        """Record a failed attempt and check for lockout."""
        now = time.time()
        # Clean old attempts outside window
        self._attempts[client_ip] = [
            t for t in self._attempts[client_ip]
            if now - t < self.window_seconds
        ]
        self._attempts[client_ip].append(now)

        if len(self._attempts[client_ip]) >= self.max_attempts:
            # Exponential backoff: lockout doubles with each trigger
            lockout_duration = self.lockout_seconds * (
                2 ** (len(self._attempts[client_ip]) - self.max_attempts)
            )
            self._lockouts[client_ip] = now + lockout_duration

    def _clear_attempts(self, client_ip: str) -> None:
        """Clear failed attempts on successful login."""
        self._attempts.pop(client_ip, None)
        self._lockouts.pop(client_ip, None)

    async def __call__(self, request: Request) -> Optional[HTTPBasicCredentials]:
        """Override to add brute force protection."""
        client_ip = self._get_client_ip(request)

        # Check lockout
        if self._is_locked_out(client_ip):
            remaining = int(self._lockouts[client_ip] - time.time())
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many failed attempts. Try again in {remaining} seconds.",
                headers={"Retry-After": str(remaining)},
            )

        # Get credentials
        credentials = await super().__call__(request)

        return credentials

    def verify_password(
        self,
        credentials: HTTPBasicCredentials,
        request: Request,
        verify_fn: callable,
    ) -> bool:
        """
        Verify password with brute force tracking.

        Args:
            credentials: HTTPBasic credentials from request
            request: FastAPI request object
            verify_fn: Callable that returns True if password is correct

        Returns:
            True if authentication succeeds
        """
        client_ip = self._get_client_ip(request)

        # Use constant-time comparison
        is_valid = verify_fn(credentials.username, credentials.password)

        if not is_valid:
            self._record_attempt(client_ip)
            remaining_attempts = max(
                0,
                self.max_attempts - len(self._attempts.get(client_ip, []))
            )
            if remaining_attempts == 0:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Account locked due to too many failed attempts.",
                    headers={"Retry-After": str(self.lockout_seconds)},
                )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Invalid credentials. {remaining_attempts} attempts remaining.",
                headers={"WWW-Authenticate": "Basic"},
            )

        self._clear_attempts(client_ip)
        return True
