"""Pagination utilities for FastAPI applications.

Supports both offset-based and cursor-based pagination with standardized response models.
"""

from __future__ import annotations

import base64
import json
import math
from typing import Any, Generic, Optional, Sequence, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class PaginationParams(BaseModel):
    """Query parameters for offset-based pagination."""
    page: int = Field(default=1, ge=0, description="Page number (1-indexed, 0 returns empty)")
    page_size: int = Field(default=20, ge=0, le=100, description="Items per page")

    @property
    def offset(self) -> int:
        if self.page <= 0:
            return 0
        return (self.page - 1) * self.page_size

    @property
    def limit(self) -> int:
        return self.page_size


class CursorParams(BaseModel):
    """Query parameters for cursor-based pagination."""
    cursor: Optional[str] = Field(default=None, description="Opaque cursor for next page")
    page_size: int = Field(default=20, ge=0, le=100, description="Items per page")


class PaginatedResponse(BaseModel, Generic[T]):
    """Standardized paginated response model."""
    items: list[T]
    total: int
    page: int
    page_size: int
    total_pages: int
    has_next: bool
    has_previous: bool


class CursorPaginatedResponse(BaseModel, Generic[T]):
    """Cursor-based paginated response model."""
    items: list[T]
    next_cursor: Optional[str] = None
    previous_cursor: Optional[str] = None
    has_next: bool
    has_previous: bool
    total: Optional[int] = None


class Paginator:
    """Pagination utility for any data source."""

    @staticmethod
    def paginate_offset(items, total, page, page_size):
        if page < 0:
            page = 0
        if page_size < 0:
            page_size = 0
        total_pages = math.ceil(total / page_size) if page_size > 0 else 0
        if page <= 0:
            has_next, has_previous = total > 0, False
        else:
            has_next = page < total_pages
            has_previous = page > 1
        return PaginatedResponse(
            items=list(items), total=total, page=max(page, 0),
            page_size=page_size, total_pages=total_pages,
            has_next=has_next, has_previous=has_previous,
        )

    @staticmethod
    def encode_cursor(data):
        return base64.urlsafe_b64encode(json.dumps(data, default=str).encode()).decode()

    @staticmethod
    def decode_cursor(cursor):
        try:
            return json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
        except (ValueError, TypeError, UnicodeDecodeError) as e:
            raise ValueError(f"Invalid cursor: {e}") from e

    @classmethod
    def paginate_cursor(cls, items, page_size, cursor_field="id", cursor=None, get_field=None, total=None):
        has_next = len(items) > page_size
        page_items = list(items[:page_size])
        previous_cursor = cursor
        next_cursor = None
        if has_next and page_items:
            last_item = page_items[-1]
            if get_field:
                cursor_value = get_field(last_item)
            elif isinstance(last_item, dict):
                cursor_value = last_item.get(cursor_field)
            else:
                cursor_value = getattr(last_item, cursor_field, None)
            if cursor_value is not None:
                next_cursor = cls.encode_cursor({"field": cursor_field, "value": str(cursor_value)})
        return CursorPaginatedResponse(
            items=page_items, next_cursor=next_cursor,
            previous_cursor=previous_cursor, has_next=has_next,
            has_previous=cursor is not None, total=total,
        )


def paginate(page=1, page_size=20):
    """FastAPI dependency for offset-based pagination."""
    return PaginationParams(page=page, page_size=page_size)


def cursor_paginate(cursor=None, page_size=20):
    """FastAPI dependency for cursor-based pagination."""
    return CursorParams(cursor=cursor, page_size=page_size)
