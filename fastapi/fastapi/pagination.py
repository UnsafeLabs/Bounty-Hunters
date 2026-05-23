from collections.abc import Sequence
from math import ceil
from typing import Any, Generic, TypeVar

from fastapi import Query
from pydantic import BaseModel

T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
    total_pages: int
    has_next: bool
    has_previous: bool


class CursorPage(BaseModel, Generic[T]):
    items: list[T]
    next_cursor: str | None = None
    previous_cursor: str | None = None
    has_next: bool = False
    has_previous: bool = False
    total: int | None = None


class Paginator:
    def __init__(self, default_page_size: int = 20, max_page_size: int = 100):
        self.default_page_size = default_page_size
        self.max_page_size = max_page_size

    def get_params(self, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100)):
        return page, min(page_size, self.max_page_size)

    def paginate(self, items: Sequence[T], total: int, page: int, page_size: int) -> Page[T]:
        return Page(
            items=list(items),
            total=total,
            page=page,
            page_size=page_size,
            total_pages=max(1, ceil(total / page_size)) if page_size > 0 else 1,
            has_next=(page * page_size) < total,
            has_previous=page > 1,
        )

    async def paginate_query(self, query, page: int, page_size: int) -> Page[Any]:
        total = await query.count()
        items = await query.offset((page - 1) * page_size).limit(page_size).all()
        return self.paginate(items, total, page, page_size)
