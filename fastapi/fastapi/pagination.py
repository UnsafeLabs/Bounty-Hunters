"""Standardized offset and cursor pagination for FastAPI routes (issue #802)."""

from __future__ import annotations

import base64
import json
import math
from typing import Any, Generic, List, Optional, Sequence, TypeVar

from pydantic import BaseModel, Field
from typing_extensions import Annotated

try:
    from fastapi import Depends, HTTPException, Query
except ImportError:  # allow pure-unit import without full fastapi install
    Depends = None  # type: ignore
    HTTPException = Exception  # type: ignore
    Query = None  # type: ignore

T = TypeVar("T")


class PaginationParams(BaseModel):
    """Normalized page / page_size query parameters."""

    page: int = Field(1, ge=1, description="1-based page index")
    page_size: int = Field(20, ge=1, le=100, description="Items per page")

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size

    @property
    def limit(self) -> int:
        return self.page_size

    def clamp_empty(self) -> "PaginationParams":
        return self


class PaginatedResponse(BaseModel, Generic[T]):
    """Standard paginated envelope wrapping any item type."""

    items: List[T]
    total: int
    page: int
    page_size: int
    total_pages: int
    has_next: bool
    has_previous: bool
    next_cursor: Optional[str] = None
    previous_cursor: Optional[str] = None


def _encode_cursor(payload: dict) -> str:
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _decode_cursor(cursor: str) -> dict:
    pad = "=" * (-len(cursor) % 4)
    try:
        raw = base64.urlsafe_b64decode(cursor + pad)
        data = json.loads(raw.decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("cursor must be object")
        return data
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"invalid cursor: {exc}") from exc


class Paginator:
    """Offset + cursor pagination utility."""

    def __init__(self, page: int = 1, page_size: int = 20, cursor: Optional[str] = None):
        # Edge cases: page 0 / negative / page_size 0 -> sensible defaults / clamp
        if page is None or page < 1:
            page = 1
        if page_size is None or page_size < 1:
            page_size = 20
        if page_size > 100:
            page_size = 100
        self.page = int(page)
        self.page_size = int(page_size)
        self.cursor = cursor
        self._cursor_data: Optional[dict] = None
        if cursor:
            self._cursor_data = _decode_cursor(cursor)
            # Cursor may carry page override
            if "page" in self._cursor_data:
                self.page = max(1, int(self._cursor_data["page"]))
            if "page_size" in self._cursor_data:
                ps = int(self._cursor_data["page_size"])
                self.page_size = min(100, max(1, ps))

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size

    @property
    def limit(self) -> int:
        return self.page_size

    def slice(self, items: Sequence[T], total: Optional[int] = None) -> PaginatedResponse[T]:
        """Paginate an in-memory sequence (offset style)."""
        total_count = len(items) if total is None else int(total)
        total_pages = math.ceil(total_count / self.page_size) if self.page_size else 0
        if total_count == 0:
            total_pages = 0
        start = self.offset
        end = start + self.page_size
        page_items = list(items[start:end])
        has_previous = self.page > 1 and total_count > 0
        has_next = self.page < total_pages
        next_cursor = (
            _encode_cursor({"page": self.page + 1, "page_size": self.page_size})
            if has_next
            else None
        )
        previous_cursor = (
            _encode_cursor({"page": self.page - 1, "page_size": self.page_size})
            if has_previous
            else None
        )
        return PaginatedResponse(
            items=page_items,
            total=total_count,
            page=self.page,
            page_size=self.page_size,
            total_pages=total_pages,
            has_next=has_next,
            has_previous=has_previous,
            next_cursor=next_cursor,
            previous_cursor=previous_cursor,
        )

    def from_window(
        self,
        items: Sequence[T],
        total: int,
        *,
        cursor_key: str = "id",
    ) -> PaginatedResponse[T]:
        """Build response for a pre-sliced DB window (caller applied offset/limit)."""
        total = int(total)
        total_pages = math.ceil(total / self.page_size) if self.page_size and total else 0
        has_previous = self.page > 1 and total > 0
        has_next = self.page < total_pages
        next_cursor = None
        previous_cursor = None
        if has_next and items:
            last = items[-1]
            token = getattr(last, cursor_key, None)
            if token is None and isinstance(last, dict):
                token = last.get(cursor_key)
            next_cursor = _encode_cursor(
                {"page": self.page + 1, "page_size": self.page_size, "after": token}
            )
        if has_previous:
            previous_cursor = _encode_cursor(
                {"page": self.page - 1, "page_size": self.page_size}
            )
        return PaginatedResponse(
            items=list(items),
            total=total,
            page=self.page,
            page_size=self.page_size,
            total_pages=total_pages,
            has_next=has_next,
            has_previous=has_previous,
            next_cursor=next_cursor,
            previous_cursor=previous_cursor,
        )


def get_pagination_params(
    page: int = 1,
    page_size: int = 20,
    cursor: Optional[str] = None,
) -> PaginationParams:
    """Pure helper (no FastAPI Depends) — safe for unit tests."""
    p = Paginator(page=page, page_size=page_size, cursor=cursor)
    return PaginationParams(page=p.page, page_size=p.page_size)


def paginate(
    page: int = 1,
    page_size: int = 20,
    cursor: Optional[str] = None,
) -> Paginator:
    """
    Dependency-style factory.

    When FastAPI is available, prefer `Depends(pagination_dependency)`.
    """
    return Paginator(page=page, page_size=page_size, cursor=cursor)


# FastAPI Query dependency when framework is importable
if Query is not None:

    def pagination_dependency(
        page: Annotated[int, Query(ge=0, description="Page (1-based; 0 coerced to 1)")] = 1,
        page_size: Annotated[
            int, Query(ge=0, le=100, description="Page size (0 coerced to 20)")
        ] = 20,
        cursor: Annotated[Optional[str], Query(description="Opaque cursor")] = None,
    ) -> Paginator:
        return Paginator(page=page, page_size=page_size, cursor=cursor)

else:

    def pagination_dependency(  # type: ignore[misc]
        page: int = 1,
        page_size: int = 20,
        cursor: Optional[str] = None,
    ) -> Paginator:
        return Paginator(page=page, page_size=page_size, cursor=cursor)
