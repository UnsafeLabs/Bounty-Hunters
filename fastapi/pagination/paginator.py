"""
Fix: Implement standardized pagination with offset and cursor support (#802)

Provides both offset-based (page/size) and cursor-based (keyset) pagination
with a unified interface, response models, and FastAPI dependency injection.
"""

from __future__ import annotations
from typing import TypeVar, Generic, Optional, Any, Callable
from dataclasses import dataclass, field
from datetime import datetime
import base64
import json

from fastapi import Query, Depends
from pydantic import BaseModel, Field
from sqlalchemy import Select
from sqlalchemy.orm import Session

T = TypeVar("T")


# === Response Models ===

class PaginationMeta(BaseModel):
    """Pagination metadata in response"""
    total: Optional[int] = Field(None, description="Total items (offset mode only)")
    page: Optional[int] = Field(None, description="Current page number (offset mode)")
    per_page: Optional[int] = Field(None, description="Items per page (offset mode)")
    total_pages: Optional[int] = Field(None, description="Total pages (offset mode)")
    has_next: bool = Field(False, description="More items available")
    has_prev: bool = Field(False, description="Previous items available")
    next_cursor: Optional[str] = Field(None, description="Cursor for next page (cursor mode)")
    prev_cursor: Optional[str] = Field(None, description="Cursor for previous page (cursor mode)")


class PaginatedResponse(BaseModel, Generic[T]):
    """Standard paginated response wrapper"""
    items: list[T] = Field(default_factory=list)
    meta: PaginationMeta = Field(default_factory=PaginationMeta)


# === Pagination Parameters ===

@dataclass
class OffsetParams:
    """Offset-based pagination: page + per_page"""
    page: int = Field(1, ge=1)
    per_page: int = Field(20, ge=1, le=100)


@dataclass
class CursorParams:
    """Cursor-based pagination: cursor + limit"""
    cursor: Optional[str] = None
    limit: int = Field(20, ge=1, le=100)
    direction: str = Field("next", pattern="^(next|prev)$")


# === Dependency Injection ===

def offset_pagination(
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(20, ge=1, le=100, description="Items per page"),
) -> OffsetParams:
    return OffsetParams(page=page, per_page=per_page)


def cursor_pagination(
    cursor: Optional[str] = Query(None, description="Pagination cursor"),
    limit: int = Query(20, ge=1, le=100, description="Items per page"),
    direction: str = Query("next", description="next or prev"),
) -> CursorParams:
    return CursorParams(cursor=cursor, limit=limit, direction=direction)


# === Cursor Encoding ===

def encode_cursor(data: dict) -> str:
    """Encode cursor data as base64 JSON"""
    return base64.urlsafe_b64encode(json.dumps(data).encode()).decode()


def decode_cursor(cursor: str) -> dict:
    """Decode base64 JSON cursor"""
    try:
        return json.loads(base64.urlsafe_b64decode(cursor.encode()))
    except (json.JSONDecodeError, ValueError):
        raise ValueError(f"Invalid cursor: {cursor}")


# === SQLAlchemy Paginator ===

class OffsetPaginator(Generic[T]):
    """Offset-based pagination for SQLAlchemy queries"""

    def __init__(self, db: Session, query: Select, per_page: int = 20):
        self.db = db
        self.query = query
        self.per_page = per_page

    def paginate(self, page: int = 1) -> PaginatedResponse:
        total = self.db.query(self.query.subquery()).count()
        total_pages = (total + self.per_page - 1) // self.per_page

        items = (
            self.db.execute(
                self.query.offset((page - 1) * self.per_page).limit(self.per_page)
            )
            .scalars()
            .all()
        )

        return PaginatedResponse(
            items=items,
            meta=PaginationMeta(
                total=total,
                page=page,
                per_page=self.per_page,
                total_pages=total_pages,
                has_next=page < total_pages,
                has_prev=page > 1,
            ),
        )


class CursorPaginator(Generic[T]):
    """Cursor-based (keyset) pagination for SQLAlchemy queries"""

    def __init__(
        self,
        db: Session,
        query: Select,
        cursor_field: str = "id",
        per_page: int = 20,
    ):
        self.db = db
        self.query = query
        self.cursor_field = cursor_field
        self.per_page = per_page

    def paginate(self, cursor: Optional[str] = None, direction: str = "next") -> PaginatedResponse:
        query = self.query
        cursor_value = None

        if cursor:
            cursor_data = decode_cursor(cursor)
            cursor_value = cursor_data.get("value")

            from sqlalchemy import column
            col = column(self.cursor_field)
            if direction == "next":
                query = query.where(col > cursor_value)
            else:
                query = query.where(col < cursor_value)

        # Fetch one extra to check has_next
        items = self.db.execute(query.limit(self.per_page + 1)).scalars().all()
        has_next = len(items) > self.per_page
        items = items[: self.per_page]

        # Build cursors from first/last items
        next_cursor = None
        prev_cursor = None

        if items:
            last_item = items[-1]
            last_val = getattr(last_item, self.cursor_field, None)
            if last_val is not None:
                next_cursor = encode_cursor({"value": last_val})

            first_item = items[0]
            first_val = getattr(first_item, self.cursor_field, None)
            if first_val is not None and cursor:
                prev_cursor = encode_cursor({"value": first_val})

        return PaginatedResponse(
            items=items,
            meta=PaginationMeta(
                has_next=has_next,
                has_prev=cursor is not None,
                next_cursor=next_cursor,
                prev_cursor=prev_cursor,
            ),
        )
