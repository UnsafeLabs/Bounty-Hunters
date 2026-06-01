"""
Dynamic CORS origin validation with callback support.
Extends Starlette's CORSMiddleware with dynamic origin resolution.
"""
from starlette.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp
from typing import Callable, List, Optional, Union
import fnmatch


class DynamicCORSMiddleware(CORSMiddleware):
    """
    CORS middleware with dynamic origin validation via callback.

    Usage:
        def validate_origin(origin: str) -> bool:
            return origin.endswith(".example.com")

        app.add_middleware(DynamicCORSMiddleware, origin_validator=validate_origin)
    """

    def __init__(
        self,
        app: ASGIApp,
        allow_origins: List[str] = None,
        origin_validator: Optional[Callable[[str], bool]] = None,
        allow_origin_patterns: Optional[List[str]] = None,
        allow_methods: List[str] = None,
        allow_headers: List[str] = None,
        allow_credentials: bool = False,
        expose_headers: List[str] = None,
        max_age: int = 600,
    ):
        self._origin_validator = origin_validator
        self._allow_origin_patterns = allow_origin_patterns or []

        super().__init__(
            app,
            allow_origins=allow_origins or ["*"],
            allow_methods=allow_methods or ["GET"],
            allow_headers=allow_headers or [],
            allow_credentials=allow_credentials,
            expose_headers=expose_headers or [],
            max_age=max_age,
        )

    def is_allowed_origin(self, origin: str) -> bool:
        """Check if origin is allowed via static list, patterns, or callback."""
        # Check static origins first
        if origin in self.allow_all_origin:
            return True

        # Check pattern matching (e.g., *.example.com)
        for pattern in self._allow_origin_patterns:
            if fnmatch.fnmatch(origin, pattern):
                return True

        # Check dynamic callback
        if self._origin_validator:
            try:
                return self._origin_validator(origin)
            except Exception:
                return False

        return False


def create_dynamic_cors_middleware(
    origin_validator: Optional[Callable[[str], bool]] = None,
    allow_origin_patterns: Optional[List[str]] = None,
    **kwargs,
) -> type:
    """
    Factory function to create a configured DynamicCORSMiddleware.

    Args:
        origin_validator: Callback that returns True if origin is allowed
        allow_origin_patterns: List of fnmatch patterns (e.g., ["*.example.com"])
        **kwargs: Additional CORS configuration

    Returns:
        Configured middleware class
    """
    def middleware_factory(app: ASGIApp) -> DynamicCORSMiddleware:
        return DynamicCORSMiddleware(
            app,
            origin_validator=origin_validator,
            allow_origin_patterns=allow_origin_patterns,
            **kwargs,
        )
    return middleware_factory
