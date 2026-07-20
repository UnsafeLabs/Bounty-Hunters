"""Router-level middleware support for APIRouter (issue #796)."""

from __future__ import annotations

from typing import Any, Callable, List, Optional, Sequence, Tuple, Type, Union

# Middleware can be Starlette-style class or simple callable
MiddlewareClass = Type[Any]
MiddlewareCallable = Callable[..., Any]
MiddlewareEntry = Union[
    MiddlewareClass,
    MiddlewareCallable,
    Tuple[MiddlewareClass, dict],
]


class RouterMiddlewareMixin:
    """
    Mixin/helper providing router-scoped middleware list and add_middleware.

    Router middleware only applies to routes registered on that router.
    """

    def __init__(self, middleware: Optional[Sequence[MiddlewareEntry]] = None) -> None:
        self.user_middleware: List[MiddlewareEntry] = list(middleware or [])

    def add_middleware(self, middleware_class: MiddlewareEntry, **kwargs: Any) -> None:
        if kwargs and not isinstance(middleware_class, tuple):
            self.user_middleware.append((middleware_class, kwargs))  # type: ignore[arg-type]
        else:
            self.user_middleware.append(middleware_class)

    def iter_middleware(self) -> List[MiddlewareEntry]:
        return list(self.user_middleware)


def apply_middleware_stack(
    app: Callable,
    middleware: Sequence[MiddlewareEntry],
) -> Callable:
    """
    Wrap an ASGI/call app with middleware in the order they were added
    (last added is outermost, matching Starlette).
    """
    for entry in reversed(list(middleware)):
        if isinstance(entry, tuple):
            cls, options = entry
            app = cls(app, **options)
        elif isinstance(entry, type):
            app = entry(app)
        else:
            # callable middleware factory (app) -> app
            app = entry(app)
    return app


def merge_router_middleware(
    parent: Sequence[MiddlewareEntry],
    child: Sequence[MiddlewareEntry],
) -> List[MiddlewareEntry]:
    """Preserve child middleware when include_router mounts a sub-router."""
    return list(child) + list(parent)
