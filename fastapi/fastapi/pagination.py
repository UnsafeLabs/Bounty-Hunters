from __future__ import annotations

import base64
import json
import math
from typing import Any, Generic, Optional, Sequence, TypeVar

from fastapi import Query
from pydantic import BaseModel

T = TypeVar("T")


class PaginationParams(BaseModel):
    """Pagination query parameters."""
    page: int = Query(1, ge=1, description="Page number (1-based)")
    page_size: int = Query(20, ge=1, le=100, description="Items per page")


class CursorParams(BaseModel):
    """Cursor-based pagination parameters."""
    cursor: Optional[str] = Query(None, description="Opaque cursor for pagination")
    limit: int = Query(20, ge=1, le=100, description="Items per page")


class PaginatedResponse(BaseModel, Generic[T]):
    """Standardized paginated response wrapping any item type."""
    items: list[T]
    total: int
    page: int
    page_size: int
    total_pages: int
    has_next: bool
    has_previous: bool


class CursorPaginatedResponse(BaseModel, Generic[T]):
    """Cursor-based paginated response."""
    items: list[T]
    next_cursor: Optional[str] = None
    has_more: bool
    limit: int


class Paginator:
    """Paginator supporting offset-based and cursor-based pagination."""

    @staticmethod
    def paginate(
        items: Sequence[Any],
        total: int,
        page: int,
        page_size: int,
    ) -> PaginatedResponse:
        """Create an offset-based paginated response."""
        if page < 1:
            page = 1
        if page_size < 1:
            page_size = 1

        total_pages = max(1, math.ceil(total / page_size)) if total > 0 else 0

        return PaginatedResponse(
            items=list(items),
            total=total,
            page=page,
            page_size=page_size,
            total_pages=total_pages,
            has_next=page < total_pages,
            has_previous=page > 1,
        )

    @staticmethod
    def paginate_cursor(
        items: Sequence[Any],
        has_more: bool,
        next_cursor_value: Optional[str] = None,
        limit: int = 20,
    ) -> CursorPaginatedResponse:
        """Create a cursor-based paginated response."""
        next_cursor = None
        if next_cursor_value is not None:
            cursor_data = json.dumps({"cursor": next_cursor_value}).encode()
            next_cursor = base64.urlsafe_b64encode(cursor_data).decode()

        return CursorPaginatedResponse(
            items=list(items),
            next_cursor=next_cursor,
            has_more=has_more,
            limit=limit,
        )

    @staticmethod
    def decode_cursor(cursor: str) -> Any:
        """Decode an opaque cursor string."""
        try:
            decoded = base64.urlsafe_b64decode(cursor.encode())
            return json.loads(decoded).get("cursor")
        except Exception:
            return None


# Dependency injection functions
def pagination_params(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
) -> PaginationParams:
    return PaginationParams(page=page, page_size=page_size)


def cursor_params(
    cursor: Optional[str] = Query(None, description="Pagination cursor"),
    limit: int = Query(20, ge=1, le=100, description="Items per page"),
) -> CursorParams:
    return CursorParams(cursor=cursor, limit=limit)
