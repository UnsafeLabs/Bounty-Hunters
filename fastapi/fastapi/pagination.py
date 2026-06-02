"""
Standardized pagination module for FastAPI — offset and cursor-based pagination.

Features:
- Offset pagination (page/page_size)
- Cursor pagination (base64-encoded cursor)
- Generic PaginatedResponse type wrapping any Pydantic model
- FastAPI dependency injection via `paginate` function
- SQLAlchemy + in-memory list support
"""

from typing import Any, Callable, Generic, Optional, Sequence, TypeVar
from fastapi import Depends, Query, HTTPException
from pydantic import BaseModel
import base64, json

# ── Type vars ──────────────────────────────────────────────────────
T = TypeVar("T")  # Item type (Pydantic model)
T_co = TypeVar("T_co", covariant=True)


# ── Request params ─────────────────────────────────────────────────

class OffsetParams(BaseModel):
    """Offset-based pagination query parameters."""
    page: int = Query(1, ge=1, description="Page number (1-indexed)")
    page_size: int = Query(20, ge=1, le=100, description="Items per page")
    pagination: str = Query("offset", description="Pagination mode: 'offset' or 'cursor'")


class CursorParams(BaseModel):
    """Cursor-based pagination query parameters."""
    cursor: Optional[str] = Query(None, description="Base64-encoded cursor")
    page_size: int = Query(20, ge=1, le=100, description="Items per page")
    pagination: str = Query("cursor", description="Pagination mode: 'cursor' or 'offset'")


# ── Response models ────────────────────────────────────────────────

class PaginatedResponse(BaseModel, Generic[T]):
    """Generic paginated response wrapping any Pydantic item type."""
    items: list[T]
    total: int
    page: int
    page_size: int
    total_pages: int
    has_next: bool
    has_previous: bool


class CursorResponse(BaseModel, Generic[T]):
    """Cursor-based paginated response."""
    items: list[T]
    total: int
    next_cursor: Optional[str] = None
    previous_cursor: Optional[str] = None
    has_next: bool
    has_previous: bool


# ── Paginator ──────────────────────────────────────────────────────

class Paginator:
    """Unified paginator supporting offset and cursor modes."""

    @staticmethod
    def encode_cursor(value: Any) -> str:
        """Encode a value into a base64 cursor string."""
        raw = json.dumps({"v": value}, separators=(",", ":"))
        return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")

    @staticmethod
    def decode_cursor(cursor: str) -> Any:
        """Decode a cursor string back to its original value."""
        try:
            padding = 4 - len(cursor) % 4
            if padding != 4:
                cursor += "=" * padding
            raw = base64.urlsafe_b64decode(cursor)
            return json.loads(raw)["v"]
        except (json.JSONDecodeError, ValueError, KeyError, Exception):
            raise HTTPException(status_code=400, detail="Invalid cursor")

    def paginate_offset(
        self,
        items: Sequence[Any],
        page: int,
        page_size: int,
        *,
        total: Optional[int] = None,
    ) -> PaginatedResponse:
        """Apply offset-based pagination to a sequence of items."""
        if total is None:
            total = len(items)

        total_pages = max(1, (total + page_size - 1) // page_size)
        start = (page - 1) * page_size
        end = start + page_size
        page_items = list(items[start:end])

        return PaginatedResponse(
            items=page_items,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=total_pages,
            has_next=page < total_pages,
            has_previous=page > 1,
        )

    def paginate_cursor(
        self,
        items: Sequence[Any],
        cursor: Optional[str],
        page_size: int,
        *,
        cursor_key: str = "id",
    ) -> CursorResponse:
        """Apply cursor-based pagination.

        Args:
            items: Full sorted item list (must be sortable by cursor_key).
            cursor: Base64-encoded cursor value (None = first page).
            page_size: Items per page.
            cursor_key: Attribute name used as cursor value (default: "id").
        """
        start_index = 0
        if cursor:
            cursor_value = self.decode_cursor(cursor)
            for i, item in enumerate(items):
                item_val = getattr(item, cursor_key, item[cursor_key] if isinstance(item, dict) else item)
                if str(item_val) == str(cursor_value):
                    start_index = i + 1
                    break

        end_index = start_index + page_size
        page_items = list(items[start_index:end_index])
        total = len(items)

        # Build cursors for navigation
        next_cursor = None
        prev_cursor = None
        if end_index < total:
            last_item = page_items[-1]
            last_val = getattr(last_item, cursor_key, last_item[cursor_key] if isinstance(last_item, dict) else last_item)
            next_cursor = self.encode_cursor(last_val)
        if start_index > 0 and items:
            first_item_of_this_page = page_items[0] if page_items else items[min(start_index, total - 1)]
            first_val = getattr(first_item_of_this_page, cursor_key,
                                first_item_of_this_page[cursor_key] if isinstance(first_item_of_this_page, dict) else first_item_of_this_page)
            prev_cursor = self.encode_cursor(first_val)

        return CursorResponse(
            items=page_items,
            total=total,
            next_cursor=next_cursor,
            previous_cursor=prev_cursor,
            has_next=end_index < total,
            has_previous=start_index > 0,
        )

    def paginate(
        self,
        items: Sequence[Any],
        params: OffsetParams | CursorParams,
        *,
        total: Optional[int] = None,
        cursor_key: str = "id",
    ) -> PaginatedResponse | CursorResponse:
        """Unified pagination. Auto-selects mode based on params."""
        if isinstance(params, CursorParams) or (hasattr(params, "pagination") and params.pagination == "cursor"):
            return self.paginate_cursor(
                items, 
                getattr(params, "cursor", None), 
                params.page_size,
                cursor_key=cursor_key,
            )
        return self.paginate_offset(
            items,
            getattr(params, "page", 1),
            params.page_size,
            total=total,
        )


# ── FastAPI dependency ─────────────────────────────────────────────

# Singleton paginator instance
paginator = Paginator()


def get_offset_params(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    pagination: str = Query("offset", regex="^(offset|cursor)$"),
) -> OffsetParams:
    """FastAPI dependency: inject offset pagination params."""
    return OffsetParams(page=page, page_size=page_size, pagination=pagination)


def get_cursor_params(
    cursor: Optional[str] = Query(None),
    page_size: int = Query(20, ge=1, le=100),
    pagination: str = Query("cursor", regex="^(offset|cursor)$"),
) -> CursorParams:
    """FastAPI dependency: inject cursor pagination params."""
    return CursorParams(cursor=cursor, page_size=page_size, pagination=pagination)


# ── Easier: single paginate dependency ─────────────────────────────

def paginate_dependency(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    cursor: Optional[str] = Query(None),
    pagination: str = Query("offset", regex="^(offset|cursor)$"),
) -> OffsetParams | CursorParams:
    """Single dependency that handles both offset and cursor modes."""
    if pagination == "cursor":
        return CursorParams(cursor=cursor, page_size=page_size, pagination=pagination)
    return OffsetParams(page=page, page_size=page_size, pagination=pagination)
