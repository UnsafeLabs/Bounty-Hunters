import base64
import time
from collections import defaultdict
from typing import Optional

from fastapi import HTTPException, Request, status
from fastapi.security.http import HTTPBasic, HTTPBasicCredentials
from fastapi.openapi.models import HTTPBase as HTTPBaseModel
from fastapi.security.base import SecurityBase
from starlette.status import HTTP_401_UNAUTHORIZED, HTTP_429_TOO_MANY_REQUESTS
import hashlib
import hmac


class HTTPBasicWithProtection(HTTPBasic):
    """HTTP Basic authentication with brute force protection."""

    def __init__(
        self,
        max_attempts: int = 5,
        window_seconds: int = 300,
        realm: str = "Protected",
    ):
        super().__init__(realm=realm)
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self._attempts: dict[str, list[float]] = defaultdict(list)

    async def __call__(self, request: Request) -> Optional[HTTPBasicCredentials]:
        client_ip = request.client.host if request.client else "unknown"
        self._clean_attempts(client_ip)

        if len(self._attempts[client_ip]) >= self.max_attempts:
            retry_after = self.window_seconds
            raise HTTPException(
                status_code=HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many authentication attempts. Try again later.",
                headers={"Retry-After": str(retry_after)},
            )

        credentials = await super().__call__(request)
        if credentials is None:
            return None

        # Record successful attempt (reset counter)
        self._attempts.pop(client_ip, None)
        return credentials

    def _record_failure(self, client_ip: str) -> None:
        self._attempts[client_ip].append(time.time())
        self._clean_attempts(client_ip)

    def _clean_attempts(self, client_ip: str) -> None:
        now = time.time()
        self._attempts[client_ip] = [
            t for t in self._attempts[client_ip]
            if now - t < self.window_seconds
        ]
        if not self._attempts[client_ip]:
            self._attempts.pop(client_ip, None)

    @staticmethod
    def verify_password(password: str, stored_hash: str) -> bool:
        """Timing-safe password verification."""
        if password is None or stored_hash is None:
            return False
        return hmac.compare_digest(password.encode(), stored_hash.encode())
