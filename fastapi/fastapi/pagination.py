"""Standardized pagination utilities for FastAPI.

Provides:
- ``PaginationParams``: query-parameter dependency (page / page_size) with
  sensible defaults and edge-case normalization.
- ``PaginatedResponse[T]``: generic response model wrapping any Pydantic
  model: items, total, page, page_size, total_pages, has_next, has_previous.
- ``paginate``: dependency yielding a ready-to-use Paginator bound to the
  request's query parameters.
- ``paginate_offset`` / ``paginate_cursor``: helpers for offset-based and
  cursor-based pagination over any sequence or SQLAlchemy-style select.
- ``encode_cursor`` / ``decode_cursor``: opaque, URL-safe cursor codec.

Usage::

    from fastapi import Depends, FastAPI
    from fastapi.pagination import PaginatedResponse, PaginationParams, paginate_offset

    app = FastAPI()

    @app.get("/items", response_model=PaginatedResponse[Item])
    def list_items(pager=Depends(PaginationParams()), items: list[Item] = ...):
        return paginate_offset(items, pager.page, pager.page_size)
"""

from __future__ import annotations

import base64
import binascii
import json
from math import ceil
from typing import Any, Generic, Optional, Sequence, TypeVar

from fastapi import Query
from pydantic import BaseModel, Field

__all__ = [
    "DEFAULT_PAGE",
    "DEFAULT_PAGE_SIZE",
    "MAX_PAGE_SIZE",
    "MIN_PAGE_SIZE",
    "PaginationParams",
    "PaginatedResponse",
    "Paginator",
    "decode_cursor",
    "encode_cursor",
    "paginate",
    "paginate_cursor",
    "paginate_offset",
]

T = TypeVar("T")

DEFAULT_PAGE = 1
DEFAULT_PAGE_SIZE = 25
MIN_PAGE_SIZE = 1
MAX_PAGE_SIZE = 500


class PaginationParams(BaseModel):
    """Normalized pagination query parameters.

    Edge cases are clamped rather than rejected: ``page 0`` and negative
    pages become page 1; ``page_size 0`` or negative becomes the minimum;
    oversized page sizes are clamped to ``MAX_PAGE_SIZE``.
    """

    page: int = DEFAULT_PAGE
    page_size: int = DEFAULT_PAGE_SIZE

    @classmethod
    def as_dependency(
        cls,
        page: int = Query(DEFAULT_PAGE, description="1-based page number"),
        page_size: int = Query(
            DEFAULT_PAGE_SIZE, ge=MIN_PAGE_SIZE, le=MAX_PAGE_SIZE, description="Items per page"
        ),
    ) -> "PaginationParams":
        return cls(page=page, page_size=page_size)

    def __call__(
        self,
        page: int = Query(DEFAULT_PAGE, description="1-based page number"),
        page_size: int = Query(
            DEFAULT_PAGE_SIZE, ge=MIN_PAGE_SIZE, le=MAX_PAGE_SIZE, description="Items per page"
        ),
    ) -> "PaginationParams":
        return PaginationParams(page=page, page_size=page_size)

    @property
    def offset(self) -> int:
        """SQL-style skip for the current page."""
        return (self.page - 1) * self.page_size

    @property
    def limit(self) -> int:
        """SQL-style limit for the current page."""
        return self.page_size


class PaginatedResponse(BaseModel, Generic[T]):
    """Standardized paginated response envelope for any item model."""

    items: list[T] = Field(default_factory=list)
    total: int = 0
    page: int = DEFAULT_PAGE
    page_size: int = DEFAULT_PAGE_SIZE
    total_pages: int = 0
    has_next: bool = False
    has_previous: bool = False
    next_cursor: Optional[str] = None
    previous_cursor: Optional[str] = None


class Paginator:
    """Offset/cursor pagination over an in-memory sequence.

    Works with any sized sequence (list, tuple, SQLAlchemy result lists).
    """

    def __init__(self, page: int = DEFAULT_PAGE, page_size: int = DEFAULT_PAGE_SIZE) -> None:
        self.params = PaginationParams(page=page, page_size=page_size)

    @property
    def page(self) -> int:
        return self.params.page

    @property
    def page_size(self) -> int:
        return self.params.page_size

    @property
    def offset(self) -> int:
        return self.params.offset

    @property
    def limit(self) -> int:
        return self.params.limit

    def paginate(self, items: Sequence[T], total: Optional[int] = None) -> PaginatedResponse[T]:
        return paginate_offset(items, self.page, self.page_size, total=total)

    def paginate_cursor(
        self,
        items: Sequence[T],
        *,
        total: Optional[int] = None,
        cursor: Optional[str] = None,
    ) -> PaginatedResponse[T]:
        return paginate_cursor(
            items, self.page_size, total=total, cursor=cursor, page=self.page
        )


def _normalize_page(page: int, page_size: int) -> tuple[int, int]:
    page = max(int(page), 1) if isinstance(page, int) else DEFAULT_PAGE
    try:
        page_size = int(page_size)
    except (TypeError, ValueError):
        page_size = DEFAULT_PAGE_SIZE
    page_size = min(max(page_size, MIN_PAGE_SIZE), MAX_PAGE_SIZE)
    return page, page_size


def paginate_offset(
    items: Sequence[T],
    page: int = DEFAULT_PAGE,
    page_size: int = DEFAULT_PAGE_SIZE,
    *,
    total: Optional[int] = None,
) -> PaginatedResponse[T]:
    """Offset-based pagination over a sequence.

    ``total`` may be supplied explicitly (e.g. a SQL ``COUNT(*)``); when
    omitted the sequence length is used.
    """
    page, page_size = _normalize_page(page, page_size)
    full_total = total if total is not None else len(items)
    full_total = max(int(full_total), 0)
    total_pages = ceil(full_total / page_size) if full_total else 0

    offset = (page - 1) * page_size
    window = list(items[offset : offset + page_size]) if full_total else []

    return PaginatedResponse[T](
        items=window,
        total=full_total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        has_next=page < total_pages,
        has_previous=page > 1 and full_total > 0,
    )


def encode_cursor(payload: dict[str, Any]) -> str:
    """Encode an arbitrary JSON-serializable cursor payload as an opaque
    URL-safe, unpadded base64 string."""
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_cursor(cursor: Optional[str]) -> Optional[dict[str, Any]]:
    """Decode an opaque cursor produced by :func:`encode_cursor`.

    Returns ``None`` for empty cursors; raises ``ValueError`` for malformed
    ones so callers can surface a 400.
    """
    if not cursor:
        return None
    padding = "=" * (-len(cursor) % 4)
    try:
        raw = base64.urlsafe_b64decode((cursor + padding).encode("ascii"))
        payload = json.loads(raw.decode("utf-8"))
    except (binascii.Error, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"Invalid cursor: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError("Invalid cursor: payload must be an object")
    return payload


def paginate_cursor(
    items: Sequence[T],
    page_size: int = DEFAULT_PAGE_SIZE,
    *,
    total: Optional[int] = None,
    cursor: Optional[str] = None,
    page: int = DEFAULT_PAGE,
) -> PaginatedResponse[T]:
    """Cursor-based pagination over a sequence.

    The cursor encodes the offset (or any caller-supplied keyset payload)
    as an opaque string. ``next_cursor`` / ``previous_cursor`` are populated
    for forward/backward navigation; ``items`` are sliced from the decoded
    cursor position.
    """
    _, page_size = _normalize_page(page, page_size)
    full_total = total if total is not None else len(items)
    full_total = max(int(full_total), 0)

    payload = decode_cursor(cursor) or {}
    offset = int(payload.get("offset", 0))
    offset = min(max(offset, 0), full_total)

    window = list(items[offset : offset + page_size])
    reached_end = offset + page_size >= full_total
    has_previous = offset > 0

    next_cursor = (
        encode_cursor({**payload, "offset": offset + page_size})
        if not reached_end and full_total
        else None
    )
    previous_cursor = (
        encode_cursor({**payload, "offset": max(offset - page_size, 0)})
        if has_previous
        else None
    )

    return PaginatedResponse[T](
        items=window,
        total=full_total,
        page=page,
        page_size=page_size,
        total_pages=ceil(full_total / page_size) if full_total else 0,
        has_next=not reached_end and full_total > 0,
        has_previous=has_previous,
        next_cursor=next_cursor,
        previous_cursor=previous_cursor,
    )


def paginate(
    page: int = Query(DEFAULT_PAGE, ge=1, description="1-based page number"),
    page_size: int = Query(
        DEFAULT_PAGE_SIZE, ge=MIN_PAGE_SIZE, le=MAX_PAGE_SIZE, description="Items per page"
    ),
) -> Paginator:
    """FastAPI dependency yielding a :class:`Paginator` for any route."""
    return Paginator(page=page, page_size=page_size)
