from __future__ import annotations

import base64
import json
import math
from collections.abc import Callable, Iterable, Sequence
from typing import Annotated, Any, Generic, TypeVar

from pydantic import BaseModel

from .param_functions import Query

T = TypeVar("T")
QueryT = TypeVar("QueryT")
CursorKey = str | Callable[[Any], Any] | None


class PaginatedResponse(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
    total_pages: int
    has_next: bool
    has_previous: bool
    next_cursor: str | None = None
    previous_cursor: str | None = None


class Paginator:
    def __init__(
        self,
        page: int = 1,
        page_size: int = 50,
        *,
        max_page_size: int = 100,
    ) -> None:
        self.max_page_size = max(max_page_size, 1)
        self.page = max(page, 1)
        self.page_size = min(max(page_size, 1), self.max_page_size)

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size

    @property
    def skip(self) -> int:
        return self.offset

    @property
    def limit(self) -> int:
        return self.page_size

    def total_pages(self, total: int) -> int:
        if total <= 0:
            return 0
        return math.ceil(total / self.page_size)

    def create_response(
        self,
        items: Iterable[T],
        *,
        total: int,
        page: int | None = None,
        next_cursor: str | None = None,
        previous_cursor: str | None = None,
    ) -> PaginatedResponse[T]:
        current_page = self.page if page is None else max(page, 1)
        total_pages = self.total_pages(total)
        return PaginatedResponse[T](
            items=list(items),
            total=max(total, 0),
            page=current_page,
            page_size=self.page_size,
            total_pages=total_pages,
            has_next=current_page < total_pages,
            has_previous=current_page > 1 and total_pages > 0,
            next_cursor=next_cursor,
            previous_cursor=previous_cursor,
        )

    def paginate_sequence(self, items: Sequence[T]) -> PaginatedResponse[T]:
        return self.create_response(
            items[self.offset : self.offset + self.page_size],
            total=len(items),
        )

    def apply(self, query: QueryT) -> QueryT:
        offset = query.offset
        limit = offset(self.offset).limit
        return limit(self.limit)

    def encode_cursor(self, value: Any) -> str:
        raw = json.dumps({"value": value}, default=str, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(raw).decode().rstrip("=")

    def decode_cursor(self, cursor: str) -> Any:
        padding = "=" * (-len(cursor) % 4)
        raw = base64.urlsafe_b64decode(f"{cursor}{padding}".encode())
        payload = json.loads(raw.decode())
        return payload["value"]

    def paginate_cursor(
        self,
        items: Sequence[T],
        *,
        after: str | None = None,
        before: str | None = None,
        cursor_key: CursorKey = None,
    ) -> PaginatedResponse[T]:
        total = len(items)
        start = self._cursor_start(items, after, before, cursor_key)
        page_items = list(items[start : start + self.page_size])
        has_next = start + self.page_size < total
        has_previous = start > 0
        page = (start // self.page_size) + 1
        return PaginatedResponse[T](
            items=page_items,
            total=total,
            page=page,
            page_size=self.page_size,
            total_pages=self.total_pages(total),
            has_next=has_next,
            has_previous=has_previous,
            next_cursor=self._page_cursor(
                page_items[-1], start + len(page_items) - 1, cursor_key
            )
            if has_next and page_items
            else None,
            previous_cursor=self._page_cursor(page_items[0], start, cursor_key)
            if has_previous and page_items
            else None,
        )

    def _cursor_start(
        self,
        items: Sequence[T],
        after: str | None,
        before: str | None,
        cursor_key: CursorKey,
    ) -> int:
        if before is not None:
            before_index = self._find_cursor_index(items, before, cursor_key)
            return max(before_index - self.page_size, 0)
        if after is not None:
            after_index = self._find_cursor_index(items, after, cursor_key)
            return min(after_index + 1, len(items))
        return 0

    def _find_cursor_index(
        self, items: Sequence[T], cursor: str, cursor_key: CursorKey
    ) -> int:
        cursor_value = self.decode_cursor(cursor)
        for index, item in enumerate(items):
            if self._cursor_value(item, index, cursor_key) == cursor_value:
                return index
        return -1

    def _page_cursor(self, item: T, index: int, cursor_key: CursorKey) -> str:
        return self.encode_cursor(self._cursor_value(item, index, cursor_key))

    def _cursor_value(self, item: T, index: int, cursor_key: CursorKey) -> Any:
        if cursor_key is None:
            return index
        if callable(cursor_key):
            return cursor_key(item)
        if isinstance(item, dict):
            return item[cursor_key]
        return getattr(item, cursor_key)


def paginate(
    page: Annotated[
        int,
        Query(description="1-based page number."),
    ] = 1,
    page_size: Annotated[
        int,
        Query(description="Number of items per page."),
    ] = 50,
) -> Paginator:
    return Paginator(page=page, page_size=page_size)
