from __future__ import annotations

import logging
import re
import threading
import uuid
from typing import Set

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi.routing import APIRoute

logger = logging.getLogger(__name__)

_sanitise_re = re.compile(r"[^a-z0-9_]", re.ASCII)
_generated_ids: Set[str] = set()
_lock = threading.Lock()
_MAX_SUFFIX_ATTEMPTS = 1000
_FALLBACK_BASE = "operation"


def _reset_generated_ids() -> None:
    """Clear all cached unique operation IDs.

    Useful between application instances (e.g., in tests) to prevent state
    leakage.  This function is thread‑safe.
    """
    global _generated_ids
    with _lock:
        _generated_ids.clear()
        logger.debug("Reset operation ID cache.")


def generate_unique_id(route: APIRoute) -> str:
    """Generate a unique operation ID for OpenAPI documentation.

    The ID is formatted as ``method_prefix_functionname``, using only lowercase
    alphanumeric characters and underscores.  If the generated ID collides with
    a previously generated one, a numeric suffix (starting at 1) is appended
    until the ID is unique across the current application instance.

    Args:
        route: The ``APIRoute`` instance for which to generate the ID.

    Returns:
        A sanitised, unique operation ID string.

    Raises:
        TypeError: If ``route`` is ``None``.
        ValueError: If ``route`` lacks the required attributes (``methods``,
            ``prefix``, ``endpoint`` with ``__name__``).

    Example:
        >>> from fastapi import APIRouter
        >>> router = APIRouter(prefix="/users")
        >>> @router.get("/")
        ... def list_users(): pass
        >>> route = router.routes[-1]
        >>> generate_unique_id(route)
        'get_users_list_users'
    """
    if route is None:
        raise TypeError("route must not be None")

    # ---------- Extract HTTP method ----------
    methods = route.methods
    if not methods:
        logger.warning("Route has no HTTP methods; falling back to 'unknown'.")
        method = "unknown"
    else:
        # Use sorted to ensure deterministic ordering for multiple methods
        method = sorted(methods)[0].lower()

    # ---------- Extract and sanitise prefix ----------
    prefix = route.prefix or ""
    prefix = prefix.strip("/").replace("/", "_")

    # ---------- Extract endpoint function name ----------
    endpoint = getattr(route, "endpoint", None)
    if endpoint is None:
        raise ValueError("Route has no endpoint attribute")
    try:
        func_name = endpoint.__name__
    except AttributeError:
        raise ValueError("Route endpoint has no __name__ attribute") from None

    # ---------- Build raw string ----------
    parts = [method]
    if prefix:
        parts.append(prefix)
    parts.append(func_name)
    raw = "_".join(parts)

    # ---------- Sanitise ----------
    sanitized = _sanitise_re.sub("", raw.lower())
    if not sanitized:
        logger.warning(
            "Sanitised ID is empty (raw: '%s'); falling back to '%s'.",
            raw, _FALLBACK_BASE,
        )
        sanitized = _FALLBACK_BASE

    base_id = sanitized
    counter = 0

    # ---------- Ensure uniqueness ----------
    with _lock:
        while sanitized in _generated_ids:
            counter += 1
            if counter > _MAX_SUFFIX_ATTEMPTS:
                logger.error(
                    "Could not generate unique ID after %d attempts; "
                    "using random fallback.",
                    _MAX_SUFFIX_ATTEMPTS,
                )
                sanitized = f"{base_id}_{uuid.uuid4().hex[:8]}"
                break
            sanitized = f"{base_id}_{counter}"
            logger.debug(
                "Collision detected for '%s'; trying '%s'.", base_id, sanitized,
            )
        _generated_ids.add(sanitized)

    logger.debug("Generated operation ID: %s", sanitized)
    return sanitized


__all__ = ["generate_unique_id", "_reset_generated_ids"]
