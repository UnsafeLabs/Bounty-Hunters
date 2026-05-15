"""
Standardized pagination utilities for FastAPI applications.

Supports both offset-based (page/page_size) and cursor-based pagination.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Generic, Sequence, TypeVar

from fastapi import Depends, Query
from pydantic import BaseModel, ConfigDict


T = TypeVar("T")


class PageResponse(BaseModel, Generic[T]):
    """Standardized paginated response model."""

    model_config = ConfigDict(from_attributes=True)

    items: Sequence[T]
    total: int
    page: int
    page_size: int
    total_pages: int
    has_next: bool
    has_previous: bool


@dataclass
class PaginationParams:
    """Dependency-injectable pagination parameters."""

    page: int = Query(1, ge=1, description="Current page number (1-indexed)")
    page_size: int = Query(20, ge=1, le=100, description="Number of items per page")


@dataclass
class CursorParams:
    """Dependency-injectable cursor pagination parameters."""

    cursor: str | None = Query(None, description="Opaque cursor string from previous response")
    limit: int = Query(20, ge=1, le=100, description="Number of items to return")


def compute_pages(total: int, page_size: int) -> tuple[int, bool, bool]:
    """Compute pagination metadata from total count and page_size."""
    total_pages = (total + page_size - 1) // page_size if page_size > 0 else 0
    return total_pages


class Paginator(Generic[T]):
    """
    Paginate any sequence or data source.

    Usage:
        @router.get("/items")
        def list_items(p: PaginationParams = Depends()):
            data = fetch_items_from_db(offset=(p.page-1)*p.page_size, limit=p.page_size)
            total = count_items()
            return paginate(data, total, p.page, p.page_size)
    """

    def __init__(self, items: Sequence[T], total: int, page: int = 1, page_size: int = 20):
        self.items = items
        self.total = total
        self.page = page
        self.page_size = page_size

    def response(self) -> PageResponse[T]:
        """Build a standardized PageResponse."""
        total_pages = compute_pages(self.total, self.page_size)
        return PageResponse(
            items=self.items,
            total=self.total,
            page=self.page,
            page_size=self.page_size,
            total_pages=total_pages,
            has_next=self.page < total_pages,
            has_previous=self.page > 1,
        )


def paginate(
    items: Sequence[T],
    total: int,
    page: int = 1,
    page_size: int = 20,
) -> PageResponse[T]:
    """
    Paginate a sequence and return a standardized PageResponse.

    Args:
        items: The slice of data for this page.
        total: Total count of all items (across all pages).
        page: Current page number (1-indexed).
        page_size: Number of items per page.

    Returns:
        PageResponse[T] with pagination metadata.
    """
    total_pages = compute_pages(total, page_size)
    return PageResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        has_next=page < total_pages,
        has_previous=page > 1,
    )


@dataclass
class CursorPaginator(Generic[T]):
    """
    Cursor-based pagination for stable pagination across mutable data sets.

    The cursor encodes the position (offset) in the result set.
    """

    items: Sequence[T]
    total: int | None = None  # optional total count
    next_cursor: str | None = None
    prev_cursor: str | None = None

    def encode_cursor(offset: int, limit: int) -> str:
        """Encode offset/limit into a base64 cursor string."""
        import base64
        data = f"{offset}:{limit}".encode()
        return base64.urlsafe_b64encode(data).decode()

    def decode_cursor(cursor: str) -> tuple[int, int]:
        """Decode a cursor string back to (offset, limit)."""
        import base64
        data = base64.urlsafe_b64decode(cursor.encode()).decode()
        offset, limit = data.split(":")
        return int(offset), int(limit)

    def response(self, next_offset: int | None = None, prev_offset: int | None = None) -> dict[str, Any]:
        """Build a cursor-based response dict."""
        return {
            "items": self.items,
            "next_cursor": self.encode_cursor(next_offset, len(self.items)) if next_offset is not None else None,
            "prev_cursor": self.encode_cursor(prev_offset, len(self.items)) if prev_offset is not None else None,
        }