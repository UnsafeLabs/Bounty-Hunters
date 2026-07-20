"""Unique OpenAPI operation ID generation with collision suffixes (issue #764)."""

from __future__ import annotations

import re
from typing import Iterable, Optional, Set


def sanitize_operation_id(raw: str) -> str:
    operation_id = re.sub(r"[^a-zA-Z0-9_]+", "_", raw).lower()
    operation_id = re.sub(r"_+", "_", operation_id).strip("_")
    return operation_id or "operation"


def build_operation_id(
    *,
    method: str,
    path: str,
    function_name: str,
) -> str:
    method = method.lower()
    prefix = path.strip("/").replace("/", "_")
    name = function_name or "route"
    raw = f"{method}_{prefix}_{name}" if prefix else f"{method}_{name}"
    return sanitize_operation_id(raw)


class OperationIdRegistry:
    """Tracks seen IDs and appends numeric suffixes on collision."""

    def __init__(self) -> None:
        self._seen: Set[str] = set()

    def register(self, operation_id: str) -> str:
        base = sanitize_operation_id(operation_id)
        if base not in self._seen:
            self._seen.add(base)
            return base
        n = 2
        while f"{base}_{n}" in self._seen:
            n += 1
        final = f"{base}_{n}"
        self._seen.add(final)
        return final

    def clear(self) -> None:
        self._seen.clear()


def unique_ids_for_routes(
    routes: Iterable[tuple[str, str, str]],
) -> list[str]:
    """routes: iterable of (method, path, function_name)."""
    reg = OperationIdRegistry()
    out: list[str] = []
    for method, path, name in routes:
        out.append(reg.register(build_operation_id(method=method, path=path, function_name=name)))
    return out
