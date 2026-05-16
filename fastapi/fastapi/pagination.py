"""FastAPI Pagination Module - Offset + Cursor based pagination"""
from __future__ import annotations

import base64
import json
from typing import Any, Generic, Sequence, TypeVar

from fastapi import Query
from fastapi.exceptions import HTTPException
from pydantic import BaseModel

T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    """Standard paginated response wrapping any item type."""

    items: list[T]
    total: int
    page: int
    page_size: int
    total_pages: int
    has_next: bool
    has_previous: bool


class CursorPage(BaseModel, Generic[T]):
    """Cursor-based paginated response."""

    items: list[T]
    next_cursor: str | None
    previous_cursor: str | None
    has_next: bool
    has_previous: bool


def _encode_cursor(value: Any) -> str:
    """Encode a cursor value for URL-safe transmission."""
    return base64.urlsafe_b64encode(str(value).encode()).decode()


def _decode_cursor(cursor: str) -> str:
    """Decode a cursor value."""
    try:
        return base64.urlsafe_b64decode(cursor.encode()).decode()
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid cursor")


def paginate(
    items: Sequence[Any],
    total: int,
    page: int = Query(1, ge=1, description="Page number (1-indexed)"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
) -> PaginatedResponse[Any]:
    """Offset-based pagination dependency.

    Usage::

        @app.get("/items")
        def list_items(pagination: dict = Depends(paginate)):
            page = pagination["page"]
            page_size = pagination["page_size"]
            ...
            return paginated_response(items, total, page, page_size)

    Or use the dependency injection form::

        @app.get("/items")
        def list_items(
            page: int = Query(1, ge=1),
            page_size: int = Query(20, ge=1, le=100),
        ):
            return get_paginated_response(items, total, page, page_size)

    Returns a dict with ``skip`` and ``limit`` for database queries.
    """
    return {
        "skip": (page - 1) * page_size,
        "limit": page_size,
        "page": page,
        "page_size": page_size,
    }


def paginated_response(
    items: Sequence[Any],
    total: int,
    page: int,
    page_size: int,
) -> PaginatedResponse[Any]:
    """Build a ``PaginatedResponse`` from query results.

    Args:
        items: The items for the current page.
        total: Total number of items across all pages.
        page: Current page number (1-indexed).
        page_size: Number of items per page.

    Returns:
        A ``PaginatedResponse`` instance with calculated metadata.
    """
    total_pages = max(1, (total + page_size - 1) // page_size)
    return PaginatedResponse(
        items=list(items),
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        has_next=page < total_pages,
        has_previous=page > 1,
    )


def cursor_paginate(
    cursor: str | None = Query(None, description="Encoded cursor for pagination"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
) -> dict[str, Any]:
    """Cursor-based pagination dependency.

    Usage::

        @app.get("/items")
        def list_items(pagination: dict = Depends(cursor_paginate)):
            cursor = pagination.get("cursor")
            limit = pagination["limit"]
            ...
    """
    decoded = None
    if cursor:
        decoded = _decode_cursor(cursor)
    return {"cursor": decoded, "limit": page_size + 1, "page_size": page_size}


def cursor_paginated_response(
    items: Sequence[Any],
    has_more: bool,
    cursor_field: str = "id",
    page_size: int = 20,
) -> CursorPage[Any]:
    """Build a ``CursorPage`` response.

    Args:
        items: Items for the current page (may include one extra for has_more).
        has_more: Whether more items exist beyond this page.
        cursor_field: The field name to use as the cursor value.
        page_size: Number of items per page.

    Returns:
        A ``CursorPage`` instance with encoded cursors.
    """
    display_items = list(items[:page_size])
    next_cursor = None
    previous_cursor = None

    if has_more and display_items:
        last = display_items[-1]
        cursor_val = getattr(last, cursor_field, None) or (
            last.get(cursor_field) if isinstance(last, dict) else None
        )
        if cursor_val is not None:
            next_cursor = _encode_cursor(cursor_val)

    if display_items:
        first = display_items[0]
        cursor_val = getattr(first, cursor_field, None) or (
            first.get(cursor_field) if isinstance(first, dict) else None
        )
        if cursor_val is not None:
            previous_cursor = _encode_cursor(cursor_val)

    return CursorPage(
        items=display_items,
        next_cursor=next_cursor,
        previous_cursor=previous_cursor,
        has_next=has_more,
        has_previous=previous_cursor is not None,
    )
