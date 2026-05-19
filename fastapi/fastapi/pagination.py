import base64
import math
from typing import Any, Generic, Sequence, TypeVar

from fastapi.param_functions import Query
from pydantic import BaseModel

T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
    total_pages: int
    has_next: bool
    has_previous: bool


class PaginationParams(BaseModel):
    page: int = Query(1, ge=1, description="Page number (1-indexed)")
    page_size: int = Query(20, ge=1, le=100, description="Number of items per page")


class Paginator:
    def __init__(self, page: int = 1, page_size: int = 20):
        if page < 1:
            page = 1
        if page_size < 1:
            page_size = 20
        self.page = page
        self.page_size = page_size

    def skip(self) -> int:
        return (self.page - 1) * self.page_size

    def limit(self) -> int:
        return self.page_size

    def offset_paginate(self, items: Sequence[Any], total: int | None = None) -> PaginatedResponse[Any]:
        if total is None:
            total = len(items)
        items = items[self.skip() : self.skip() + self.limit()]
        return self._build_response(items, total)

    def cursor_paginate(
        self,
        items: Sequence[Any],
        cursor_field: str = "id",
        total: int | None = None,
    ) -> PaginatedResponse[Any]:
        if total is None:
            total = len(items)
        items = items[: self.limit()]
        return self._build_response(items, total, cursor_field=cursor_field)

    @staticmethod
    def encode_cursor(value: Any) -> str:
        return base64.urlsafe_b64encode(str(value).encode()).decode()

    @staticmethod
    def decode_cursor(value: str) -> str:
        try:
            return base64.urlsafe_b64decode(value.encode()).decode()
        except (ValueError, base64.binascii.Error):
            return ""

    def _build_response(
        self,
        items: list[Any],
        total: int,
        cursor_field: str | None = None,
    ) -> PaginatedResponse[Any]:
        total_pages = max(1, math.ceil(total / self.page_size)) if total > 0 else 1
        return PaginatedResponse(
            items=list(items),
            total=total,
            page=self.page,
            page_size=self.page_size,
            total_pages=total_pages,
            has_next=self.page < total_pages,
            has_previous=self.page > 1,
        )


async def pagination_params(
    page: int = Query(1, ge=1, description="Page number (1-indexed)"),
    page_size: int = Query(20, ge=1, le=100, description="Number of items per page"),
) -> PaginationParams:
    return PaginationParams(page=page, page_size=page_size)


def paginate(
    items: Sequence[Any],
    page: int = 1,
    page_size: int = 20,
    total: int | None = None,
) -> PaginatedResponse[Any]:
    paginator = Paginator(page=page, page_size=page_size)
    return paginator.offset_paginate(items, total=total)
