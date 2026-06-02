"""
Pagination utilities for FastAPI with SQLAlchemy and Pydantic support.

Provides both offset-based and cursor-based pagination with standardized response models.
"""
from typing import Generic, TypeVar, List, Optional, Any, Callable
from pydantic import BaseModel, Field
from fastapi import Query, Depends
import base64
import json

T = TypeVar("T")


class PaginationParams(BaseModel):
    """Common pagination parameters."""
    page: int = Field(default=1, ge=1, description="Page number (1-indexed)")
    page_size: int = Field(default=20, ge=1, le=100, description="Items per page")

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size

    @property
    def limit(self) -> int:
        return self.page_size


class CursorParams(BaseModel):
    """Cursor-based pagination parameters."""
    cursor: Optional[str] = Field(default=None, description="Encoded cursor for next page")
    limit: int = Field(default=20, ge=1, le=100, description="Items per page")


class PaginatedResponse(BaseModel, Generic[T]):
    """Standardized paginated response wrapper."""
    items: List[T]
    total: int
    page: int
    page_size: int
    total_pages: int
    has_next: bool
    has_previous: bool

    class Config:
        from_attributes = True


class CursorPaginatedResponse(BaseModel, Generic[T]):
    """Cursor-based paginated response."""
    items: List[T]
    next_cursor: Optional[str] = None
    previous_cursor: Optional[str] = None
    has_next: bool
    has_previous: bool


class PageInfo(BaseModel):
    """Pagination metadata."""
    total: int
    page: int
    page_size: int
    total_pages: int
    has_next: bool
    has_previous: bool


def paginate(
    query: Any,
    page: int = 1,
    page_size: int = 20,
    db_session: Any = None,
) -> dict:
    """
    Apply offset-based pagination to a SQLAlchemy query.

    Args:
        query: SQLAlchemy query object (supports both 1.x Query and 2.x Select)
        page: Page number (1-indexed)
        page_size: Items per page
        db_session: SQLAlchemy session (for count query)

    Returns:
        dict with items, total, page, page_size, total_pages, has_next, has_previous
    """
    # Validate parameters
    page = max(1, page)
    page_size = max(1, min(100, page_size))

    # Get total count (compatible with both SQLAlchemy 1.x and 2.x)
    if db_session is not None:
        from sqlalchemy import func, __version__ as sa_version
        major_version = int(sa_version.split(".")[0])
        if major_version >= 2:
            # SQLAlchemy 2.x: Select object
            count_query = query.statement.with_only_columns(func.count()).order_by(None)
            total = db_session.execute(count_query).scalar() or 0
        else:
            # SQLAlchemy 1.x: Query object
            total = query.with_entities(func.count()).scalar() or 0
    else:
        total = query.count() if hasattr(query, 'count') else 0

    # Calculate pagination
    total_pages = max(1, (total + page_size - 1) // page_size)
    offset = (page - 1) * page_size

    # Fetch items
    items = query.offset(offset).limit(page_size).all()

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
        "has_next": page < total_pages,
        "has_previous": page > 1,
    }


def encode_cursor(data: dict) -> str:
    """Encode cursor data as base64 string."""
    return base64.urlsafe_b64encode(json.dumps(data).encode()).decode()


def decode_cursor(cursor: str) -> dict:
    """Decode base64 cursor string."""
    try:
        return json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
        raise ValueError("Invalid cursor")


def paginate_cursor(
    query: Any,
    cursor: Optional[str] = None,
    limit: int = 20,
    cursor_field: str = "id",
    db_session: Any = None,
) -> dict:
    """
    Apply cursor-based pagination to a SQLAlchemy query.

    Args:
        query: SQLAlchemy query object
        cursor: Encoded cursor string
        limit: Items per page
        cursor_field: Field to use for cursor (default: id)
        db_session: SQLAlchemy session

    Returns:
        dict with items, next_cursor, previous_cursor, has_next, has_previous
    """
    limit = max(1, min(100, limit))

    # Decode cursor
    cursor_data = None
    if cursor:
        cursor_data = decode_cursor(cursor)

    # Apply cursor filter
    if cursor_data and cursor_field in cursor_data:
        model_attr = getattr(query.column_descriptions[0]['type'], cursor_field)
        query = query.filter(model_attr > cursor_data[cursor_field])

    # Fetch one extra to check if there's a next page
    items = query.order_by(
        getattr(query.column_descriptions[0]['type'], cursor_field)
    ).limit(limit + 1).all()

    has_next = len(items) > limit
    items = items[:limit]

    # Generate cursors
    next_cursor = None
    previous_cursor = None

    if items:
        if has_next:
            last_item = items[-1]
            next_cursor = encode_cursor({
                cursor_field: getattr(last_item, cursor_field)
            })

        if cursor_data:
            first_item = items[0]
            previous_cursor = encode_cursor({
                cursor_field: getattr(first_item, cursor_field)
            })

    return {
        "items": items,
        "next_cursor": next_cursor,
        "previous_cursor": previous_cursor,
        "has_next": has_next,
        "has_previous": cursor is not None,
    }


def get_pagination_params(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
) -> PaginationParams:
    """FastAPI dependency for offset-based pagination parameters."""
    return PaginationParams(page=page, page_size=page_size)


def get_cursor_params(
    cursor: Optional[str] = Query(None, description="Pagination cursor"),
    limit: int = Query(20, ge=1, le=100, description="Items per page"),
) -> CursorParams:
    """FastAPI dependency for cursor-based pagination parameters."""
    return CursorParams(cursor=cursor, limit=limit)
