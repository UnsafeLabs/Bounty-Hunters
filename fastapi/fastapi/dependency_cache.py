"""Request-scoped dependency caching (issue #795)."""

from __future__ import annotations

from typing import Any, Callable, Dict, Optional


class RequestDependencyCache:
    """Per-request cache keyed by dependency callable identity."""

    def __init__(self) -> None:
        self._store: Dict[int, Any] = {}

    def get(self, dep: Callable) -> tuple[bool, Any]:
        key = id(dep)
        if key in self._store:
            return True, self._store[key]
        return False, None

    def set(self, dep: Callable, value: Any) -> None:
        self._store[id(dep)] = value

    def clear(self) -> None:
        self._store.clear()


def resolve_dependency(
    dep: Callable[[], Any],
    *,
    use_cache: bool = True,
    cache: Optional[RequestDependencyCache] = None,
) -> Any:
    """
    Resolve a zero-arg dependency, optionally using request-scoped cache.
    Mirrors Depends(use_cache=True/False) behavior for tests.
    """
    if use_cache and cache is not None:
        hit, val = cache.get(dep)
        if hit:
            return val
    value = dep()
    if use_cache and cache is not None:
        cache.set(dep, value)
    return value


async def resolve_dependency_async(
    dep: Callable,
    *,
    use_cache: bool = True,
    cache: Optional[RequestDependencyCache] = None,
) -> Any:
    import inspect

    if use_cache and cache is not None:
        hit, val = cache.get(dep)
        if hit:
            return val
    result = dep()
    if inspect.isawaitable(result):
        result = await result
    if use_cache and cache is not None:
        cache.set(dep, result)
    return result
