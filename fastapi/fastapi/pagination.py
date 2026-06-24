"""Pagination utilities for FastAPI with offset and cursor support."""

from __future__ import annotations

import base64
import json
import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Generic, TypeVar

from fastapi import Query
from pydantic import BaseModel, Field

T = TypeVar("T")


class PaginationParams(BaseModel):
    """Query parameters for offset-based pagination."""

    page: int = Field(default=1, ge=1, description="Page number (1-indexed)")
    page_size: int = Field(
        default=20, ge=1, le=100, description="Number of items per page"
    )

    @property
    def skip(self) -> int:
        """Calculate the number of items to skip."""
        return (self.page - 1) * self.page_size

    @property
    def limit(self) -> int:
        """Alias for page_size for clarity in queries."""
        return self.page_size


class CursorPaginationParams(BaseModel):
    """Query parameters for cursor-based pagination."""

    cursor: str | None = Field(
        default=None,
        description="Opaque cursor for the next page. Omit for the first page.",
    )
    page_size: int = Field(
        default=20, ge=1, le=100, description="Number of items per page"
    )


@dataclass
class CursorInfo:
    """Encodes/decodes cursor information."""

    offset: int

    def encode(self) -> str:
        """Encode offset into an opaque cursor string."""
        payload = json.dumps({"o": self.offset})
        return base64.urlsafe_b64encode(payload.encode()).decode()

    @classmethod
    def decode(cls, cursor: str) -> CursorInfo:
        """Decode an opaque cursor string back into a CursorInfo."""
        try:
            payload = json.loads(base64.urlsafe_b64decode(cursor.encode()))
            offset = int(payload["o"])
            if offset < 0:
                raise ValueError("Negative offset")
            return cls(offset=offset)
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            raise ValueError(f"Invalid cursor: {cursor}") from e


class PaginatedResponse(BaseModel, Generic[T]):
    """Standardized paginated response wrapper.

    Works with any Pydantic model as the item type via Generic[T].
    """

    items: list[T] = Field(description="List of items in the current page")
    total: int = Field(description="Total number of items across all pages")
    page: int = Field(description="Current page number (1-indexed)")
    page_size: int = Field(description="Number of items per page")
    total_pages: int = Field(description="Total number of pages")
    has_next: bool = Field(description="Whether there is a next page")
    has_previous: bool = Field(description="Whether there is a previous page")


class CursorPaginatedResponse(BaseModel, Generic[T]):
    """Standardized cursor-based paginated response wrapper."""

    items: list[T] = Field(description="List of items in the current page")
    next_cursor: str | None = Field(
        default=None,
        description="Cursor for the next page, or None if this is the last page",
    )
    previous_cursor: str | None = Field(
        default=None,
        description="Cursor for the previous page, or None if this is the first page",
    )
    has_next: bool = Field(description="Whether there is a next page")
    has_previous: bool = Field(description="Whether there is a previous page")
    page_size: int = Field(description="Number of items per page")


class Paginator:
    """Utility class for creating paginated queries.

    Supports both offset-based and cursor-based pagination strategies.

    Usage with offset pagination::

        paginator = Paginator()

        @app.get("/items")
        async def list_items(
            pagination: PaginationParams = Depends(paginator.paginate_offset),
        ):
            items = await get_items(skip=pagination.skip, limit=pagination.limit)
            total = await count_items()
            return paginator.offset_response(items, total, pagination)

    Usage with cursor pagination::

        paginator = Paginator()

        @app.get("/items")
        async def list_items(
            pagination: CursorPaginationParams = Depends(paginator.paginate_cursor),
        ):
            offset = CursorInfo.decode(pagination.cursor).offset if pagination.cursor else 0
            items = await get_items(skip=offset, limit=pagination.page_size + 1)
            has_next = len(items) > pagination.page_size
            items = items[:pagination.page_size]
            return paginator.cursor_response(items, has_next, pagination)
    """

    def __init__(
        self,
        default_page_size: int = 20,
        max_page_size: int = 100,
    ) -> None:
        if default_page_size < 1:
            raise ValueError(
                f"default_page_size must be >= 1, got {default_page_size}"
            )
        if max_page_size < 1:
            raise ValueError(f"max_page_size must be >= 1, got {max_page_size}")
        if default_page_size > max_page_size:
            raise ValueError(
                f"default_page_size ({default_page_size}) must not exceed "
                f"max_page_size ({max_page_size})"
            )
        self.default_page_size = default_page_size
        self.max_page_size = max_page_size

    def paginate_offset(
        self,
        page: int = Query(default=1, ge=1, description="Page number (1-indexed)"),
        page_size: int | None = Query(
            default=None, ge=1, le=100, description="Number of items per page"
        ),
    ) -> PaginationParams:
        """FastAPI dependency for offset-based pagination parameters.

        Inject via ``Depends(paginator.paginate_offset)``.
        """
        effective_page_size = (
            page_size if page_size is not None else self.default_page_size
        )
        clamped_page_size = max(1, min(effective_page_size, self.max_page_size))
        return PaginationParams(page=max(1, page), page_size=clamped_page_size)

    def paginate_cursor(
        self,
        cursor: str | None = Query(
            default=None,
            description="Opaque cursor for the next page. Omit for the first page.",
        ),
        page_size: int | None = Query(
            default=None, ge=1, le=100, description="Number of items per page"
        ),
    ) -> CursorPaginationParams:
        """FastAPI dependency for cursor-based pagination parameters.

        Inject via ``Depends(paginator.paginate_cursor)``.
        """
        effective_page_size = (
            page_size if page_size is not None else self.default_page_size
        )
        clamped_page_size = max(1, min(effective_page_size, self.max_page_size))
        return CursorPaginationParams(cursor=cursor, page_size=clamped_page_size)

    @staticmethod
    def offset_response(
        items: Sequence[Any],
        total: int,
        params: PaginationParams,
    ) -> dict[str, Any]:
        """Build a standardized offset-based paginated response dict.

        Returns a dict matching :class:`PaginatedResponse` schema so FastAPI
        can serialize it directly or validate against a typed model.
        """
        total_pages = max(1, math.ceil(total / params.page_size)) if total > 0 else 1
        return {
            "items": list(items),
            "total": total,
            "page": params.page,
            "page_size": params.page_size,
            "total_pages": total_pages,
            "has_next": params.page < total_pages,
            "has_previous": params.page > 1,
        }

    @staticmethod
    def cursor_response(
        items: Sequence[Any],
        has_next: bool,
        params: CursorPaginationParams,
        *,
        current_offset: int = 0,
    ) -> dict[str, Any]:
        """Build a standardized cursor-based paginated response dict.

        ``current_offset`` is the offset of the first item in *items* within
        the full dataset, used to compute ``previous_cursor``.
        """
        next_cursor: str | None = None
        previous_cursor: str | None = None

        if has_next:
            next_cursor = CursorInfo(
                offset=current_offset + len(items)
            ).encode()

        if current_offset > 0:
            prev_offset = max(0, current_offset - params.page_size)
            previous_cursor = CursorInfo(offset=prev_offset).encode()

        return {
            "items": list(items),
            "next_cursor": next_cursor,
            "previous_cursor": previous_cursor,
            "has_next": has_next,
            "has_previous": current_offset > 0,
            "page_size": params.page_size,
        }


# Convenience default instance for simple use-cases
_default_paginator = Paginator()


def paginate_offset(
    page: int = Query(default=1, ge=1, description="Page number (1-indexed)"),
    page_size: int = Query(
        default=20, ge=1, le=100, description="Number of items per page"
    ),
) -> PaginationParams:
    """Module-level dependency for offset pagination (uses default Paginator)."""
    return _default_paginator.paginate_offset(page=page, page_size=page_size)


def paginate_cursor(
    cursor: str | None = Query(
        default=None,
        description="Opaque cursor for the next page. Omit for the first page.",
    ),
    page_size: int = Query(
        default=20, ge=1, le=100, description="Number of items per page"
    ),
) -> CursorPaginationParams:
    """Module-level dependency for cursor pagination (uses default Paginator)."""
    return _default_paginator.paginate_cursor(cursor=cursor, page_size=page_size)
