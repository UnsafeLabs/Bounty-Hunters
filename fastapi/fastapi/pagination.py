from __future__ import annotations

import base64
import math
from collections.abc import Callable, Sequence
from typing import Annotated, Any, Generic, TypeVar

from fastapi import Query
from pydantic import BaseModel

ItemT = TypeVar("ItemT")


class PaginatedResponse(BaseModel, Generic[ItemT]):
    items: list[ItemT]
    total: int
    page: int
    page_size: int
    total_pages: int
    has_next: bool
    has_previous: bool
    next_cursor: str | None = None
    previous_cursor: str | None = None


class Paginator:
    def __init__(self, page: int = 1, page_size: int = 20, max_page_size: int = 100) -> None:
        self.page = max(1, page)
        self.page_size = max(1, min(page_size, max_page_size))
        self.max_page_size = max(1, max_page_size)

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size

    @property
    def limit(self) -> int:
        return self.page_size

    def apply_offset(self, query: Any) -> Any:
        return query.offset(self.offset).limit(self.limit)

    def paginate_offset(
        self,
        items: Sequence[ItemT],
        total: int | None = None,
        *,
        already_sliced: bool = False,
    ) -> PaginatedResponse[ItemT]:
        total_items = len(items) if total is None else max(0, total)
        total_pages = self._total_pages(total_items)
        page_items = list(items) if already_sliced else list(items[self.offset : self.offset + self.page_size])

        return PaginatedResponse[ItemT](
            items=page_items,
            total=total_items,
            page=self.page,
            page_size=self.page_size,
            total_pages=total_pages,
            has_next=self.page < total_pages,
            has_previous=self.page > 1 and total_items > 0,
        )

    def paginate_cursor(
        self,
        items: Sequence[ItemT],
        cursor: str | None = None,
        *,
        cursor_getter: Callable[[ItemT], str | int] | None = None,
        total: int | None = None,
    ) -> PaginatedResponse[ItemT]:
        all_items = list(items)
        total_items = len(all_items) if total is None else max(0, total)
        cursor_getter = cursor_getter or (lambda item: all_items.index(item))
        start = self._cursor_start(all_items, cursor, cursor_getter)
        page_items = all_items[start : start + self.page_size]
        total_pages = self._total_pages(total_items)

        next_cursor = None
        if page_items and start + self.page_size < len(all_items):
            next_cursor = self.encode_cursor(cursor_getter(page_items[-1]))

        previous_cursor = None
        if start > self.page_size:
            previous_cursor = self.encode_cursor(cursor_getter(all_items[start - self.page_size - 1]))

        return PaginatedResponse[ItemT](
            items=page_items,
            total=total_items,
            page=(start // self.page_size) + 1,
            page_size=self.page_size,
            total_pages=total_pages,
            has_next=next_cursor is not None,
            has_previous=start > 0,
            next_cursor=next_cursor,
            previous_cursor=previous_cursor,
        )

    @staticmethod
    def encode_cursor(value: str | int) -> str:
        payload = str(value).encode("utf-8")
        return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")

    @staticmethod
    def decode_cursor(cursor: str) -> str:
        padding = "=" * (-len(cursor) % 4)
        return base64.urlsafe_b64decode(f"{cursor}{padding}".encode("ascii")).decode("utf-8")

    def _total_pages(self, total: int) -> int:
        if total <= 0:
            return 0
        return math.ceil(total / self.page_size)

    def _cursor_start(
        self,
        items: Sequence[ItemT],
        cursor: str | None,
        cursor_getter: Callable[[ItemT], str | int],
    ) -> int:
        if cursor is None:
            return 0

        decoded_cursor = self.decode_cursor(cursor)
        for index, item in enumerate(items):
            if str(cursor_getter(item)) == decoded_cursor:
                return index + 1
        raise ValueError("Cursor not found")


def paginate(
    page: Annotated[int, Query(description="One-based page number")] = 1,
    page_size: Annotated[
        int,
        Query(description="Number of items per page"),
    ] = 20,
) -> Paginator:
    return Paginator(page=page, page_size=page_size)
