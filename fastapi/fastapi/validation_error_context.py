"""Validation error response enrichment with path/method and redacted body (issue 757)."""

from __future__ import annotations

from typing import Any, Mapping, MutableMapping, Optional, Set

SENSITIVE_KEYS = {"password", "secret", "token", "api_key", "apikey", "authorization"}


def redact_sensitive(value: Any, sensitive: Optional[Set[str]] = None) -> Any:
    keys = sensitive or SENSITIVE_KEYS
    if isinstance(value, Mapping):
        out = {}
        for k, v in value.items():
            if str(k).lower() in keys:
                out[k] = "***REDACTED***"
            else:
                out[k] = redact_sensitive(v, keys)
        return out
    if isinstance(value, list):
        return [redact_sensitive(v, keys) for v in value]
    return value


def build_validation_error_payload(
    *,
    errors: list,
    path: str,
    method: str,
    body: Any = None,
    debug: bool = False,
) -> dict:
    payload: dict[str, Any] = {
        "detail": errors,
        "path": path,
        "method": method.upper(),
    }
    if debug and body is not None:
        payload["body"] = redact_sensitive(body)
    return payload
