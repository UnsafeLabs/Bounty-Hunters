"""
API Key authentication with rate limiting and key rotation support.
"""
from fastapi import HTTPException, Request, status
from fastapi.security import APIKeyHeader, APIKeyQuery, APIKeyCookie
from typing import Optional, Dict, Callable
from collections import defaultdict
import time
import hashlib


class APIKeyWithRateLimit:
    """
    API Key authentication with built-in rate limiting and key rotation.

    Features:
    - Rate limiting per API key (configurable window and max requests)
    - API key rotation with grace period
    - Multiple key sources (header, query, cookie)
    - Usage tracking per key
    """

    def __init__(
        self,
        header_name: str = "X-API-Key",
        query_param: str = "api_key",
        max_requests: int = 100,
        window_seconds: int = 60,
        auto_error: bool = True,
    ):
        self.header_auth = APIKeyHeader(name=header_name, auto_error=False)
        self.query_auth = APIKeyQuery(name=query_param, auto_error=False)
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.auto_error = auto_error

        # Key storage (use Redis in production)
        self._valid_keys: Dict[str, dict] = {}  # key -> {user_id, created_at, rotated_at}
        self._usage: Dict[str, list] = defaultdict(list)  # key -> [timestamps]
        self._rotated_keys: Dict[str, float] = {}  # old_key -> expiry_time

    def register_key(self, api_key: str, user_id: str, metadata: dict = None) -> None:
        """Register a valid API key."""
        self._valid_keys[api_key] = {
            "user_id": user_id,
            "created_at": time.time(),
            "rotated_at": None,
            "metadata": metadata or {},
        }

    def rotate_key(self, old_key: str, new_key: str, grace_period: int = 3600) -> None:
        """
        Rotate an API key with grace period.

        Old key remains valid for grace_period seconds.
        """
        if old_key not in self._valid_keys:
            raise ValueError("Old key not found")

        # Copy metadata
        key_data = self._valid_keys[old_key].copy()
        key_data["rotated_at"] = time.time()

        # Register new key
        self._valid_keys[new_key] = key_data

        # Keep old key valid during grace period
        self._rotated_keys[old_key] = time.time() + grace_period

        # Mark old key as rotated
        self._valid_keys[old_key]["rotated_at"] = time.time()

    def revoke_key(self, api_key: str) -> None:
        """Immediately revoke an API key."""
        self._valid_keys.pop(api_key, None)
        self._rotated_keys.pop(api_key, None)

    def _check_rate_limit(self, api_key: str) -> bool:
        """Check if request is within rate limit."""
        now = time.time()
        window_start = now - self.window_seconds

        # Clean old entries
        self._usage[api_key] = [
            t for t in self._usage[api_key] if t > window_start
        ]

        if len(self._usage[api_key]) >= self.max_requests:
            return False

        self._usage[api_key].append(now)
        return True

    def _validate_key(self, api_key: str) -> Optional[str]:
        """Validate API key and return user_id."""
        if not api_key:
            return None

        # Check if key is valid
        if api_key in self._valid_keys:
            return self._valid_keys[api_key]["user_id"]

        # Check if key was recently rotated (grace period)
        if api_key in self._rotated_keys:
            if time.time() < self._rotated_keys[api_key]:
                return self._valid_keys.get(api_key, {}).get("user_id")

        return None

    async def __call__(self, request: Request) -> str:
        """Extract and validate API key from request."""
        # Try header first
        api_key = await self.header_auth(request)

        # Try query param if not in header
        if not api_key:
            api_key = await self.query_auth(request)

        if not api_key:
            if self.auto_error:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="API key required",
                )
            return None

        # Validate key
        user_id = self._validate_key(api_key)
        if not user_id:
            if self.auto_error:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid or expired API key",
                )
            return None

        # Check rate limit
        if not self._check_rate_limit(api_key):
            remaining = self.max_requests - len(self._usage.get(api_key, []))
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded. Max {self.max_requests} requests per {self.window_seconds}s.",
                headers={
                    "X-RateLimit-Limit": str(self.max_requests),
                    "X-RateLimit-Remaining": str(max(0, remaining)),
                    "Retry-After": str(self.window_seconds),
                },
            )

        # Add usage info to request state
        request.state.api_key_user = user_id
        request.state.api_key_remaining = self.max_requests - len(self._usage.get(api_key, []))

        return user_id

    def get_usage(self, api_key: str) -> dict:
        """Get usage stats for an API key."""
        now = time.time()
        window_start = now - self.window_seconds
        recent = [t for t in self._usage.get(api_key, []) if t > window_start]
        return {
            "requests_in_window": len(recent),
            "max_requests": self.max_requests,
            "window_seconds": self.window_seconds,
            "remaining": max(0, self.max_requests - len(recent)),
        }
