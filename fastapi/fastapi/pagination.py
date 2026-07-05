from __future__ import annotations

import base64
import binascii
import json
import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Annotated, Generic, TypeVar

from pydantic import BaseModel, Field

from .param_functions import Query

ItemT = TypeVar("ItemT")

DEFAULT_PAGE = 1
DEFAULT_PAGE_SIZE = 50
DEFAULT_MAX_PAGE_SIZE = 100


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


@dataclass(frozen=True)
class Paginator:
    page: int = DEFAULT_PAGE
    page_size: int = DEFAULT_PAGE_SIZE
    cursor: str | None = None
    max_page_size: int = DEFAULT_MAX_PAGE_SIZE

    def __post_init__(self) -> None:
        page = max(self.page, DEFAULT_PAGE)
        fallback_size = DEFAULT_PAGE_SIZE
        max_page_size = max(self.max_page_size, 1)
        page_size = self.page_size if self.page_size > 0 else fallback_size
        object.__setattr__(self, "page", page)
        object.__setattr__(self, "max_page_size", max_page_size)
        object.__setattr__(self, "page_size", min(page_size, max_page_size))

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size

    @property
    def limit(self) -> int:
        return self.page_size

    @property
    def cursor_offset(self) -> int:
        if self.cursor is None:
            return self.offset
        return self.decode_cursor(self.cursor)

    def offset_slice(self) -> slice:
        return slice(self.offset, self.offset + self.limit)

    def cursor_slice(self) -> slice:
        offset = self.cursor_offset
        return slice(offset, offset + self.limit)

    def apply_to_query(self, query):
        return query.offset(self.offset).limit(self.limit)

    @staticmethod
    def encode_cursor(offset: int) -> str:
        payload = json.dumps({"offset": max(offset, 0)}, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(payload).decode().rstrip("=")

    @staticmethod
    def decode_cursor(cursor: str) -> int:
        try:
            padded = cursor + "=" * (-len(cursor) % 4)
            payload = base64.urlsafe_b64decode(padded.encode())
            decoded = json.loads(payload)
            offset = int(decoded.get("offset", 0))
        except (binascii.Error, ValueError, TypeError, json.JSONDecodeError):
            return 0
        return max(offset, 0)

    def create_response(
        self,
        items: Sequence[ItemT],
        *,
        total: int,
        offset: int | None = None,
        include_cursors: bool = False,
    ) -> PaginatedResponse[ItemT]:
        normalized_total = max(total, 0)
        current_offset = self.offset if offset is None else max(offset, 0)
        total_pages = (
            math.ceil(normalized_total / self.page_size) if normalized_total else 0
        )
        page = max((current_offset // self.page_size) + 1, DEFAULT_PAGE)
        has_previous = current_offset > 0
        has_next = current_offset + len(items) < normalized_total
        previous_offset = max(current_offset - self.page_size, 0)
        next_offset = current_offset + self.page_size

        return PaginatedResponse[ItemT](
            items=list(items),
            total=normalized_total,
            page=page,
            page_size=self.page_size,
            total_pages=total_pages,
            has_next=has_next,
            has_previous=has_previous,
            next_cursor=self.encode_cursor(next_offset)
            if include_cursors and has_next
            else None,
            previous_cursor=(
                self.encode_cursor(previous_offset)
                if include_cursors and has_previous
                else None
            ),
        )

    def paginate_sequence(self, items: Sequence[ItemT]) -> PaginatedResponse[ItemT]:
        page_items = items[self.offset_slice()]
        return self.create_response(page_items, total=len(items))

    def paginate_cursor_sequence(
        self, items: Sequence[ItemT]
    ) -> PaginatedResponse[ItemT]:
        offset = self.cursor_offset
        page_items = items[self.cursor_slice()]
        return self.create_response(
            page_items,
            total=len(items),
            offset=offset,
            include_cursors=True,
        )


def paginate(
    page: Annotated[
        int, Query(description="One-based page number for offset pagination")
    ] = 1,
    page_size: Annotated[
        int,
        Query(description="Number of items per page"),
    ] = DEFAULT_PAGE_SIZE,
    cursor: Annotated[
        str | None,
        Query(description="Opaque cursor for cursor pagination"),
    ] = None,
) -> Paginator:
    return Paginator(page=page, page_size=page_size, cursor=cursor)
