"""Fix: Add rate limiting and key rotation support to API key auth (#768)

Problem: API keys never expire, no rate limiting per key,
and key rotation requires service restart.

Solution: TTL-based keys, per-key rate limiting, seamless
rotation with grace period, and automatic expiry.
"""

import hashlib
import time
import secrets
from typing import Optional
from dataclasses import dataclass, field
from collections import defaultdict

from fastapi import Request, HTTPException, Depends
from fastapi.security import APIKeyHeader


@dataclass
class APIKey:
    key_hash: str
    key_prefix: str  # First 8 chars for identification
    name: str
    created_at: float
    expires_at: Optional[float] = None
    rate_limit: int = 100  # Requests per minute
    is_active: bool = True
    rotation_of: Optional[str] = None  # Previous key hash this rotates


class APIKeyManager:
    def __init__(self, default_rate_limit: int = 100, default_ttl: int = 86400 * 90):
        self._keys: dict[str, APIKey] = {}  # key_hash -> APIKey
        self._prefix_map: dict[str, str] = {}  # prefix -> key_hash
        self._rate_counters: dict[str, list[float]] = defaultdict(list)
        self._default_rate_limit = default_rate_limit
        self._default_ttl = default_ttl
        self._rotation_grace_period = 3600  # 1 hour grace for old key

    def create_key(self, name: str, rate_limit: Optional[int] = None, ttl: Optional[int] = None) -> str:
        raw_key = f"ak_{secrets.token_urlsafe(32)}"
        key_hash = self._hash_key(raw_key)
        key_prefix = raw_key[:8]

        api_key = APIKey(
            key_hash=key_hash,
            key_prefix=key_prefix,
            name=name,
            created_at=time.time(),
            expires_at=time.time() + (ttl or self._default_ttl),
            rate_limit=rate_limit or self._default_rate_limit,
        )

        self._keys[key_hash] = api_key
        self._prefix_map[key_prefix] = key_hash

        return raw_key  # Only returned once!

    def rotate_key(self, old_key_hash: str, name: Optional[str] = None) -> Optional[str]:
        old_key = self._keys.get(old_key_hash)
        if not old_key:
            return None

        # Create new key linked to old
        new_raw = self.create_key(
            name=name or f"{old_key.name}_rotated",
            rate_limit=old_key.rate_limit,
        )
        new_hash = self._hash_key(new_raw)
        new_key = self._keys[new_hash]
        new_key.rotation_of = old_key_hash

        # Old key gets grace period
        old_key.expires_at = time.time() + self._rotation_grace_period

        return new_raw

    def validate_key(self, raw_key: str) -> tuple[bool, Optional[APIKey]]:
        key_hash = self._hash_key(raw_key)
        api_key = self._keys.get(key_hash)

        if not api_key:
            return False, None

        if not api_key.is_active:
            return False, None

        if api_key.expires_at and time.time() > api_key.expires_at:
            api_key.is_active = False
            return False, None

        # Rate limiting
        now = time.time()
        window = self._rate_counters[key_hash]
        window = [t for t in window if now - t < 60]
        self._rate_counters[key_hash] = window

        if len(window) >= api_key.rate_limit:
            return False, api_key  # Valid key but rate limited

        window.append(now)
        return True, api_key

    def _hash_key(self, raw_key: str) -> str:
        return hashlib.sha256(raw_key.encode()).hexdigest()

    def revoke_key(self, key_hash: str) -> bool:
        key = self._keys.get(key_hash)
        if key:
            key.is_active = False
            return True
        return False


# FastAPI dependency
_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)
_key_manager: Optional[APIKeyManager] = None


def get_key_manager() -> APIKeyManager:
    global _key_manager
    if _key_manager is None:
        _key_manager = APIKeyManager()
    return _key_manager


async def require_api_key(request: Request, api_key: str = Depends(_api_key_header)) -> APIKey:
    if not api_key:
        raise HTTPException(status_code=401, detail="API key required")

    manager = get_key_manager()
    valid, key_info = manager.validate_key(api_key)

    if not key_info:
        raise HTTPException(status_code=401, detail="Invalid API key")

    if not valid:
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

    return key_info
