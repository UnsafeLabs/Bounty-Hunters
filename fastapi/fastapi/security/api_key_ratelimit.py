"""API Key authentication with rate limiting and key rotation support."""
import time
from typing import Optional, List, Dict, Tuple
from fastapi.security import APIKeyHeader
from fastapi import HTTPException, Request
from starlette.status import HTTP_429_TOO_MANY_REQUESTS


class APIKeyWithRateLimit(APIKeyHeader):
    """API Key with built-in rate limiting and deprecated key support.
    
    Example:
        security = APIKeyWithRateLimit(
            name="X-API-Key",
            rate_limit="100/minute",
            deprecated_keys=["old-key-123", "old-key-456"]
        )
    """
    
    def __init__(
        self,
        *,
        name: str = "X-API-Key",
        scheme_name: Optional[str] = None,
        description: Optional[str] = None,
        auto_error: bool = True,
        rate_limit: Optional[str] = None,
        deprecated_keys: Optional[List[str]] = None
    ):
        super().__init__(
            name=name,
            scheme_name=scheme_name or name,
            description=description,
            auto_error=auto_error
        )
        self.rate_limit = rate_limit
        self.deprecated_keys = set(deprecated_keys or [])
        self._request_counts: Dict[str, List[float]] = {}
    
    def _parse_rate_limit(self) -> Tuple[int, int]:
        """Parse rate limit string like '100/minute' to (count, window_seconds)."""
        if not self.rate_limit:
            return (0, 0)
        
        parts = self.rate_limit.split("/")
        if len(parts) != 2:
            return (0, 0)
        
        count = int(parts[0])
        unit = parts[1].lower()
        
        windows = {
            "second": 1,
            "minute": 60,
            "hour": 3600,
            "day": 86400
        }
        
        return (count, windows.get(unit, 60))
    
    def _is_rate_limited(self, api_key: str) -> Tuple[bool, int]:
        """Check if API key is rate limited. Returns (is_limited, retry_after)."""
        if not self.rate_limit:
            return (False, 0)
        
        count, window = self._parse_rate_limit()
        if count == 0:
            return (False, 0)
        
        now = time.time()
        
        # Get or create request history for this key
        if api_key not in self._request_counts:
            self._request_counts[api_key] = []
        
        # Remove old requests outside the window
        cutoff = now - window
        self._request_counts[api_key] = [
            t for t in self._request_counts[api_key] if t > cutoff
        ]
        
        # Check if limit exceeded
        if len(self._request_counts[api_key]) >= count:
            retry_after = int(self._request_counts[api_key][0] - now + window)
            return (True, max(1, retry_after))
        
        # Record this request
        self._request_counts[api_key].append(now)
        return (False, 0)
    
    async def __call__(self, request: Request) -> Optional[str]:
        """Validate API key with rate limiting and deprecation checks."""
        api_key = request.headers.get(self.model.name)
        
        if not api_key:
            if self.auto_error:
                raise HTTPException(
                    status_code=HTTP_429_TOO_MANY_REQUESTS,
                    detail="API key required"
                )
            return None
        
        # Check rate limiting
        is_limited, retry_after = self._is_rate_limited(api_key)
        if is_limited:
            raise HTTPException(
                status_code=HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded",
                headers={"Retry-After": str(retry_after)}
            )
        
        # Check if key is deprecated
        if api_key in self.deprecated_keys:
            # Add warning header (will be set by caller)
            request.state.api_key_deprecated = True
        
        return api_key


def get_api_key_with_warning(request: Request) -> Optional[str]:
    """Get API key and check if deprecated warning should be added."""
    api_key = request.headers.get("X-API-Key")
    if hasattr(request.state, 'api_key_deprecated') and request.state.api_key_deprecated:
        # Warning header will be added in response
        pass
    return api_key
