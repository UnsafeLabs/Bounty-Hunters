from __future__ import annotations

import base64
import json
import math
from collections.abc import Callable, Iterable, Sequence
from typing import Annotated, Any, Generic, TypeVar

from pydantic import BaseModel, Field

from .param_functions import Query

ItemT = TypeVar("ItemT")
QueryT = TypeVar("QueryT")
CursorKey = str | Callable[[Any], Any] | None

DEFAULT_PAGE = 1
DEFAULT_PAGE_SIZE = 20
DEFAULT_MAX_PAGE_SIZE = 100


class PaginationParams(BaseModel):
    page: int = DEFAULT_PAGE
    page_size: int = DEFAULT_PAGE_SIZE
    cursor: str | None = None

    def to_paginator(self) -> Paginator[Any]:
        return Paginator(
            page=self.page,
            page_size=self.page_size,
            cursor=self.cursor,
        )


class PaginatedResponse(BaseModel, Generic[ItemT]):
    items: list[ItemT]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)
    total_pages: int = Field(ge=0)
    has_next: bool
    has_previous: bool
    next_cursor: str | None = None
    previous_cursor: str | None = None


class Paginator(Generic[ItemT]):
    def __init__(
        self,
        page: int = DEFAULT_PAGE,
        page_size: int = DEFAULT_PAGE_SIZE,
        *,
        max_page_size: int = DEFAULT_MAX_PAGE_SIZE,
        cursor: str | None = None,
    ) -> None:
        self.max_page_size = _normalize_max_page_size(max_page_size)
        self.page = _normalize_page(page)
        self.page_size = _normalize_page_size(page_size, self.max_page_size)
        self.cursor = cursor

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
        total_items = max(0, int(total))
        if total_items == 0:
            return 0
        return math.ceil(total_items / self.page_size)

    def create_response(
        self,
        items: Iterable[ItemT],
        *,
        total: int,
        page: int | None = None,
        next_cursor: str | None = None,
        previous_cursor: str | None = None,
    ) -> PaginatedResponse[ItemT]:
        total_items = max(0, int(total))
        current_page = self.page if page is None else _normalize_page(page)
        total_pages = self.total_pages(total_items)
        return PaginatedResponse[ItemT](
            items=list(items),
            total=total_items,
            page=current_page,
            page_size=self.page_size,
            total_pages=total_pages,
            has_next=current_page < total_pages,
            has_previous=current_page > 1 and total_pages > 0,
            next_cursor=next_cursor,
            previous_cursor=previous_cursor,
        )

    def paginate(
        self,
        items: Sequence[ItemT],
        *,
        total: int | None = None,
        already_sliced: bool = False,
    ) -> PaginatedResponse[ItemT]:
        total_items = len(items) if total is None else max(0, int(total))
        page_items = (
            list(items)
            if already_sliced
            else list(items[self.offset : self.offset + self.page_size])
        )
        return self.create_response(page_items, total=total_items)

    def paginate_sequence(self, items: Sequence[ItemT]) -> PaginatedResponse[ItemT]:
        return self.paginate(items)

    def apply_to_query(self, query: QueryT) -> QueryT:
        return query.offset(self.offset).limit(self.limit)

    def apply(self, query: QueryT) -> QueryT:
        return self.apply_to_query(query)

    def paginate_cursor(
        self,
        items: Sequence[ItemT],
        *,
        total: int | None = None,
        cursor: str | None = None,
        after: str | None = None,
        before: str | None = None,
        cursor_key: CursorKey = None,
    ) -> PaginatedResponse[ItemT]:
        if cursor_key is None:
            return self._paginate_offset_cursor(
                items,
                total=total,
                cursor=cursor,
            )
        return self._paginate_key_cursor(
            items,
            after=after if after is not None else cursor,
            before=before,
            cursor_key=cursor_key,
        )

    def cursor_page(
        self,
        items: Sequence[ItemT],
        *,
        total: int | None = None,
        cursor: str | None = None,
        after: str | None = None,
        before: str | None = None,
        cursor_key: CursorKey = None,
    ) -> PaginatedResponse[ItemT]:
        return self.paginate_cursor(
            items,
            total=total,
            cursor=cursor,
            after=after,
            before=before,
            cursor_key=cursor_key,
        )

    def _paginate_offset_cursor(
        self,
        items: Sequence[ItemT],
        *,
        total: int | None,
        cursor: str | None,
    ) -> PaginatedResponse[ItemT]:
        total_items = len(items) if total is None else max(0, int(total))
        active_cursor = cursor or self.cursor
        page_start = (
            _decode_offset_cursor(active_cursor)
            if active_cursor is not None
            else 0
        )
        page_start = min(max(0, page_start), total_items)
        page_end = page_start + self.page_size
        page_items = list(items[page_start:page_end])
        total_pages = self.total_pages(total_items)
        current_page = (page_start // self.page_size) + 1
        has_next = page_end < total_items
        has_previous = page_start > 0 and total_items > 0
        return PaginatedResponse[ItemT](
            items=page_items,
            total=total_items,
            page=current_page,
            page_size=self.page_size,
            total_pages=total_pages,
            has_next=has_next,
            has_previous=has_previous,
            next_cursor=encode_cursor(page_end) if has_next else None,
            previous_cursor=(
                encode_cursor(max(0, page_start - self.page_size))
                if has_previous
                else None
            ),
        )

    def _paginate_key_cursor(
        self,
        items: Sequence[ItemT],
        *,
        after: str | None,
        before: str | None,
        cursor_key: CursorKey,
    ) -> PaginatedResponse[ItemT]:
        if after is not None and before is not None:
            raise ValueError("Use either after or before cursor, not both")

        total_items = len(items)
        page_start = self._key_cursor_start(items, after, before, cursor_key)
        page_end = page_start + self.page_size
        page_items = list(items[page_start:page_end])
        has_next = page_end < total_items
        has_previous = page_start > 0 and total_items > 0
        current_page = (page_start // self.page_size) + 1
        next_cursor = (
            encode_cursor(self._cursor_value(page_items[-1], page_end - 1, cursor_key))
            if has_next and page_items
            else None
        )
        previous_cursor = self._previous_key_cursor(
            items,
            page_items,
            page_start,
            cursor_key,
        )
        return PaginatedResponse[ItemT](
            items=page_items,
            total=total_items,
            page=current_page,
            page_size=self.page_size,
            total_pages=self.total_pages(total_items),
            has_next=has_next,
            has_previous=has_previous,
            next_cursor=next_cursor,
            previous_cursor=previous_cursor,
        )

    def _key_cursor_start(
        self,
        items: Sequence[ItemT],
        after: str | None,
        before: str | None,
        cursor_key: CursorKey,
    ) -> int:
        if before is not None:
            before_index = self._find_cursor_index(items, before, cursor_key)
            return max(0, before_index - self.page_size)
        if after is not None:
            after_index = self._find_cursor_index(items, after, cursor_key)
            return min(after_index + 1, len(items))
        return 0

    def _find_cursor_index(
        self,
        items: Sequence[ItemT],
        cursor: str,
        cursor_key: CursorKey,
    ) -> int:
        cursor_value = decode_cursor(cursor)
        for index, item in enumerate(items):
            if self._cursor_value(item, index, cursor_key) == cursor_value:
                return index
        raise ValueError("Cursor does not match any item")

    def _previous_key_cursor(
        self,
        items: Sequence[ItemT],
        page_items: list[ItemT],
        page_start: int,
        cursor_key: CursorKey,
    ) -> str | None:
        if page_start <= 0 or not items:
            return None
        if page_items:
            return encode_cursor(
                self._cursor_value(page_items[0], page_start, cursor_key)
            )
        return encode_cursor(
            self._cursor_value(items[-1], len(items) - 1, cursor_key),
        )

    def _cursor_value(self, item: ItemT, index: int, cursor_key: CursorKey) -> Any:
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
        Query(description="One-based page number for offset pagination."),
    ] = DEFAULT_PAGE,
    page_size: Annotated[
        int,
        Query(description="Number of items per page."),
    ] = DEFAULT_PAGE_SIZE,
    cursor: Annotated[
        str | None,
        Query(description="Opaque cursor for cursor-based pagination."),
    ] = None,
) -> Paginator[Any]:
    return Paginator(page=page, page_size=page_size, cursor=cursor)


def encode_cursor(value: Any) -> str:
    payload = json.dumps({"value": value}, default=str, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(payload).decode().rstrip("=")


def decode_cursor(cursor: str) -> Any:
    try:
        padding = "=" * (-len(cursor) % 4)
        raw = base64.urlsafe_b64decode(f"{cursor}{padding}".encode()).decode()
        if raw.startswith("offset:"):
            return int(raw.split(":", 1)[1])
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError
        if "value" in data:
            return data["value"]
        if "offset" in data:
            return data["offset"]
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise ValueError("Invalid pagination cursor") from exc
    raise ValueError("Invalid pagination cursor")


def _decode_offset_cursor(cursor: str | None) -> int:
    if cursor is None:
        return 0
    value = decode_cursor(cursor)
    if not isinstance(value, int) or value < 0:
        raise ValueError("Invalid pagination cursor")
    return value


def _normalize_page(page: int) -> int:
    try:
        normalized = int(page)
    except (TypeError, ValueError):
        normalized = DEFAULT_PAGE
    return max(1, normalized)


def _normalize_page_size(page_size: int, max_page_size: int) -> int:
    try:
        normalized = int(page_size)
    except (TypeError, ValueError):
        normalized = DEFAULT_PAGE_SIZE
    if normalized < 1:
        normalized = DEFAULT_PAGE_SIZE
    return min(normalized, max_page_size)


def _normalize_max_page_size(max_page_size: int) -> int:
    try:
        normalized = int(max_page_size)
    except (TypeError, ValueError):
        normalized = DEFAULT_MAX_PAGE_SIZE
    return max(1, normalized)
