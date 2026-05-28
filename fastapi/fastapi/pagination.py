"""
FastAPI pagination utilities.

Provides standardized pagination with offset-based and cursor-based support.
Works with any SQLAlchemy or Pydantic-based data source.

Usage:
    from fastapi.pagination import Paginator, paginate, PaginatedResponse

    @app.get("/items")
    async def list_items(pagination: dict = Depends(paginate)):
        paginator = Paginator(**pagination)
        items, total = await get_items(offset=paginator.offset, limit=paginator.limit)
        return paginator.response(items, total)
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from typing import Any, Generic, List, Optional, Sequence, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class PaginationParams(BaseModel):
    """Query parameters for pagination."""

    page: int = Field(default=1, ge=0, description="Page number (0-indexed)")
    page_size: int = Field(
        default=20, ge=1, le=100, description="Number of items per page"
    )


class CursorPaginationParams(BaseModel):
    """Query parameters for cursor-based pagination."""

    cursor: Optional[str] = Field(
        default=None, description="Opaque cursor for next page"
    )
    page_size: int = Field(
        default=20, ge=1, le=100, description="Number of items per page"
    )


class PaginatedResponse(BaseModel, Generic[T]):
    """Standardized paginated response wrapper."""

    items: List[T] = Field(description="List of items on this page")
    total: int = Field(description="Total number of items across all pages")
    page: int = Field(description="Current page number (0-indexed)")
    page_size: int = Field(description="Number of items per page")
    total_pages: int = Field(description="Total number of pages")
    has_next: bool = Field(description="Whether there is a next page")
    has_previous: bool = Field(description="Whether there is a previous page")


class CursorPaginatedResponse(BaseModel, Generic[T]):
    """Standardized cursor-based paginated response wrapper."""

    items: List[T] = Field(description="List of items on this page")
    next_cursor: Optional[str] = Field(
        default=None, description="Cursor for the next page, null if last page"
    )
    previous_cursor: Optional[str] = Field(
        default=None, description="Cursor for the previous page, null if first page"
    )
    has_next: bool = Field(description="Whether there is a next page")
    has_previous: bool = Field(description="Whether there is a previous page")
    page_size: int = Field(description="Number of items per page")


@dataclass
class Paginator:
    """
    Offset-based paginator.

    Calculates skip/limit from page/page_size and generates
    standardized paginated responses.

    Args:
        page: Page number (0-indexed). Clamped to >= 0.
        page_size: Number of items per page. Clamped to 1-100.
    """

    page: int = 1
    page_size: int = 20

    def __post_init__(self) -> None:
        # Clamp page to >= 0
        self.page = max(0, self.page)
        # Clamp page_size to 1-100
        self.page_size = max(1, min(100, self.page_size))

    @property
    def offset(self) -> int:
        """Calculate the offset (skip) for database queries."""
        return self.page * self.page_size

    @property
    def limit(self) -> int:
        """The limit for database queries (same as page_size)."""
        return self.page_size

    def response(self, items: Sequence[Any], total: int) -> dict:
        """
        Generate a standardized paginated response.

        Args:
            items: The items on the current page.
            total: Total number of items across all pages.

        Returns:
            Dictionary with pagination metadata and items.
        """
        total_pages = self._calculate_total_pages(total, self.page_size)
        has_next = self.page < total_pages - 1
        has_previous = self.page > 0

        return {
            "items": list(items),
            "total": total,
            "page": self.page,
            "page_size": self.page_size,
            "total_pages": total_pages,
            "has_next": has_next,
            "has_previous": has_previous,
        }

    @staticmethod
    def _calculate_total_pages(total: int, page_size: int) -> int:
        """Calculate total number of pages."""
        if total <= 0:
            return 0
        return (total + page_size - 1) // page_size


@dataclass
class CursorPaginator:
    """
    Cursor-based paginator.

    Uses opaque encoded cursors for forward/backward navigation.
    Cursors encode the position of the last item on the current page.

    Args:
        cursor: Opaque cursor string from a previous response.
        page_size: Number of items per page. Clamped to 1-100.
    """

    cursor: Optional[str] = None
    page_size: int = 20

    def __post_init__(self) -> None:
        self.page_size = max(1, min(100, self.page_size))

    @property
    def offset(self) -> int:
        """Decode cursor to get the offset."""
        if self.cursor is None:
            return 0
        return self._decode_cursor(self.cursor)

    @property
    def limit(self) -> int:
        """Fetch one extra item to determine if there's a next page."""
        return self.page_size + 1

    def response(
        self,
        items: Sequence[Any],
        total: Optional[int] = None,
    ) -> dict:
        """
        Generate a standardized cursor-based paginated response.

        Args:
            items: The fetched items (may include one extra for has_next detection).
            total: Optional total count (not needed for cursor pagination).

        Returns:
            Dictionary with cursor pagination metadata and items.
        """
        has_next = len(items) > self.page_size
        # Trim to page_size
        page_items = list(items[: self.page_size])
        has_previous = self.cursor is not None

        next_cursor = None
        if has_next and page_items:
            next_offset = self.offset + self.page_size
            next_cursor = self._encode_cursor(next_offset)

        previous_cursor = None
        if has_previous:
            prev_offset = max(0, self.offset - self.page_size)
            if prev_offset > 0:
                previous_cursor = self._encode_cursor(prev_offset)

        return {
            "items": page_items,
            "next_cursor": next_cursor,
            "previous_cursor": previous_cursor,
            "has_next": has_next,
            "has_previous": has_previous,
            "page_size": self.page_size,
        }

    @staticmethod
    def _encode_cursor(offset: int) -> str:
        """Encode an offset into an opaque cursor string."""
        payload = json.dumps({"offset": offset})
        return base64.urlsafe_b64encode(payload.encode()).decode()

    @staticmethod
    def _decode_cursor(cursor: str) -> int:
        """Decode an opaque cursor string back to an offset."""
        try:
            payload = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
            return max(0, int(payload["offset"]))
        except (json.JSONDecodeError, KeyError, ValueError, TypeError):
            return 0


def paginate(
    page: int = 1,
    page_size: int = 20,
) -> dict:
    """
    FastAPI dependency for offset-based pagination.

    Usage:
        @app.get("/items")
        async def list_items(p: dict = Depends(paginate)):
            paginator = Paginator(**p)
            ...

    Returns:
        Dictionary with page and page_size for constructing a Paginator.
    """
    return {"page": page, "page_size": page_size}


def cursor_paginate(
    cursor: Optional[str] = None,
    page_size: int = 20,
) -> dict:
    """
    FastAPI dependency for cursor-based pagination.

    Usage:
        @app.get("/items")
        async def list_items(p: dict = Depends(cursor_paginate)):
            paginator = CursorPaginator(**p)
            ...

    Returns:
        Dictionary with cursor and page_size for constructing a CursorPaginator.
    """
    return {"cursor": cursor, "page_size": page_size}
