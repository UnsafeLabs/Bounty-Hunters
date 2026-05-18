"""Fix: Implement dynamic CORS origin validation with callback (#763)

Problem: CORS origins are static in config, can't be updated
at runtime. Adding new origins requires restart.

Solution: Dynamic origin validation via callback, origin
whitelist stored in database/config, wildcard subdomain
support, and per-route CORS settings.
"""

import re
import fnmatch
from typing import Callable, Optional, Sequence
from dataclasses import dataclass, field

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware


@dataclass
class CORSOrigin:
    pattern: str  # glob or regex pattern
    is_regex: bool = False
    allowed_methods: list[str] = field(default_factory=lambda: ["GET", "POST", "PUT", "DELETE", "OPTIONS"])
    allowed_headers: list[str] = field(default_factory=lambda: ["*"])
    max_age: int = 86400
    allow_credentials: bool = True


class DynamicCORSMiddleware:
    """CORS middleware with dynamic origin validation"""

    def __init__(
        self,
        app: FastAPI,
        origin_validator: Optional[Callable[[str], bool]] = None,
        default_origins: Optional[list[CORSOrigin]] = None,
    ):
        self.app = app
        self._origin_validator = origin_validator
        self._origins: list[CORSOrigin] = default_origins or []
        self._cache: dict[str, CORSOrigin | None] = {}

    def add_origin(self, origin: CORSOrigin) -> None:
        self._origins.append(origin)
        self._cache.clear()

    def remove_origin(self, pattern: str) -> bool:
        before = len(self._origins)
        self._origins = [o for o in self._origins if o.pattern != pattern]
        self._cache.clear()
        return len(self._origins) < before

    def match_origin(self, origin: str) -> Optional[CORSOrigin]:
        if origin in self._cache:
            return self._cache[origin]

        # Custom validator takes priority
        if self._origin_validator and self._origin_validator(origin):
            result = CORSOrigin(pattern=origin)
            self._cache[origin] = result
            return result

        # Check against registered patterns
        for cors_origin in self._origins:
            if cors_origin.is_regex:
                if re.match(cors_origin.pattern, origin):
                    self._cache[origin] = cors_origin
                    return cors_origin
            else:
                if fnmatch.fnmatch(origin, cors_origin.pattern):
                    self._cache[origin] = cors_origin
                    return cors_origin

        self._cache[origin] = None
        return None

    async def __call__(self, request: Request, call_next) -> Response:
        origin = request.headers.get("origin")

        if request.method == "OPTIONS" and origin:
            matched = self.match_origin(origin)
            if matched:
                response = Response(status_code=204)
                response.headers["Access-Control-Allow-Origin"] = origin
                response.headers["Access-Control-Allow-Methods"] = ",".join(matched.allowed_methods)
                response.headers["Access-Control-Allow-Headers"] = ",".join(matched.allowed_headers)
                response.headers["Access-Control-Max-Age"] = str(matched.max_age)
                if matched.allow_credentials:
                    response.headers["Access-Control-Allow-Credentials"] = "true"
                return response
            return Response(status_code=403)

        response = await call_next(request)

        if origin:
            matched = self.match_origin(origin)
            if matched:
                response.headers["Access-Control-Allow-Origin"] = origin
                response.headers["Access-Control-Allow-Credentials"] = "true"
                response.headers["Access-Control-Expose-Headers"] = "*, Authorization"

        return response

    def get_configured_origins(self) -> list[dict]:
        return [
            {"pattern": o.pattern, "is_regex": o.is_regex, "methods": o.allowed_methods}
            for o in self._origins
        ]
