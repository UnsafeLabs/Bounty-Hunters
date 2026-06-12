import base64
from math import ceil
from typing import Generic, List, Optional, TypeVar

from fastapi import Query
from pydantic import BaseModel

T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    items: List[T]
    total: int
    page: int
    page_size: int
    total_pages: int
    has_next: bool
    has_previous: bool


class CursorPaginatedResponse(BaseModel, Generic[T]):
    items: List[T]
    total: int
    page_size: int
    next_cursor: Optional[str]
    previous_cursor: Optional[str]
    has_next: bool
    has_previous: bool


def _encode_cursor(offset: int) -> str:
    return base64.b64encode(f"offset:{offset}".encode()).decode()


def _decode_cursor(cursor: str) -> int:
    try:
        decoded = base64.b64decode(cursor.encode()).decode()
        _, offset = decoded.split(":", 1)
        return int(offset)
    except Exception:
        return 0


class Paginator:
    def __init__(
        self,
        page: int = Query(default=1, ge=1),
        page_size: int = Query(default=10, ge=1, le=100),
    ):
        self.page = page
        self.page_size = page_size

    @property
    def skip(self) -> int:
        return (self.page - 1) * self.page_size

    @property
    def limit(self) -> int:
        return self.page_size

    def paginate(self, items: List, total: int) -> PaginatedResponse:
        total_pages = ceil(total / self.page_size) if total > 0 else 0
        return PaginatedResponse(
            items=items,
            total=total,
            page=self.page,
            page_size=self.page_size,
            total_pages=total_pages,
            has_next=self.page < total_pages,
            has_previous=self.page > 1,
        )

    def paginate_cursor(
        self,
        items: List,
        total: int,
        cursor: Optional[str] = None,
    ) -> CursorPaginatedResponse:
        current_offset = _decode_cursor(cursor) if cursor else 0
        next_offset = current_offset + self.page_size
        has_next = next_offset < total
        has_previous = current_offset > 0
        prev_offset = max(0, current_offset - self.page_size)
        return CursorPaginatedResponse(
            items=items,
            total=total,
            page_size=self.page_size,
            next_cursor=_encode_cursor(next_offset) if has_next else None,
            previous_cursor=_encode_cursor(prev_offset) if has_previous else None,
            has_next=has_next,
            has_previous=has_previous,
        )


def paginate(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
) -> Paginator:
    return Paginator(page=page, page_size=page_size)
