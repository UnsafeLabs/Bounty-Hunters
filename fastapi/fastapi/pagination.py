import base64
import json
import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Annotated, Generic, TypeVar

from pydantic import BaseModel, Field

from .param_functions import Query


ItemT = TypeVar("ItemT")
QueryT = TypeVar("QueryT")

DEFAULT_PAGE = 1
DEFAULT_PAGE_SIZE = 20
DEFAULT_MAX_PAGE_SIZE = 100


class PaginationParams(BaseModel):
    page: int = DEFAULT_PAGE
    page_size: int = DEFAULT_PAGE_SIZE
    cursor: str | None = None

    def to_paginator(self) -> "Paginator[ItemT]":
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


@dataclass(slots=True)
class Paginator(Generic[ItemT]):
    page: int = DEFAULT_PAGE
    page_size: int = DEFAULT_PAGE_SIZE
    max_page_size: int = DEFAULT_MAX_PAGE_SIZE
    cursor: str | None = None

    def __post_init__(self) -> None:
        self.page = max(1, self.page)
        if self.page_size < 1:
            self.page_size = DEFAULT_PAGE_SIZE
        self.page_size = min(self.page_size, self.max_page_size)

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size

    @property
    def limit(self) -> int:
        return self.page_size

    def apply_to_query(self, query: QueryT) -> QueryT:
        return query.offset(self.offset).limit(self.limit)

    def paginate(
        self,
        items: Sequence[ItemT],
        *,
        total: int | None = None,
        already_sliced: bool = False,
    ) -> PaginatedResponse[ItemT]:
        total_items = len(items) if total is None else max(0, total)
        page_items = (
            list(items)
            if already_sliced
            else list(items[self.offset : self.offset + self.page_size])
        )
        total_pages = _total_pages(total_items, self.page_size)
        return PaginatedResponse[ItemT](
            items=page_items,
            total=total_items,
            page=self.page,
            page_size=self.page_size,
            total_pages=total_pages,
            has_next=self.page < total_pages,
            has_previous=self.page > 1 and total_pages > 0,
        )

    def paginate_cursor(
        self,
        items: Sequence[ItemT],
        *,
        total: int | None = None,
    ) -> PaginatedResponse[ItemT]:
        total_items = len(items) if total is None else max(0, total)
        start = _decode_cursor(self.cursor) if self.cursor else 0
        start = min(max(0, start), total_items)
        end = start + self.page_size
        page_items = list(items[start:end])
        next_offset = end if end < total_items else None
        previous_offset = max(0, start - self.page_size) if start > 0 else None

        return PaginatedResponse[ItemT](
            items=page_items,
            total=total_items,
            page=(start // self.page_size) + 1,
            page_size=self.page_size,
            total_pages=_total_pages(total_items, self.page_size),
            has_next=next_offset is not None,
            has_previous=previous_offset is not None,
            next_cursor=_encode_cursor(next_offset) if next_offset is not None else None,
            previous_cursor=(
                _encode_cursor(previous_offset)
                if previous_offset is not None
                else None
            ),
        )


def paginate(
    page: Annotated[
        int,
        Query(
            description="One-based page number for offset pagination.",
        ),
    ] = DEFAULT_PAGE,
    page_size: Annotated[
        int,
        Query(
            description="Number of items per page.",
        ),
    ] = DEFAULT_PAGE_SIZE,
    cursor: Annotated[
        str | None,
        Query(
            description="Opaque cursor for cursor-based pagination.",
        ),
    ] = None,
) -> PaginationParams:
    paginator: Paginator[object] = Paginator(
        page=page,
        page_size=page_size,
        cursor=cursor,
    )
    return PaginationParams(
        page=paginator.page,
        page_size=paginator.page_size,
        cursor=paginator.cursor,
    )


def encode_cursor(offset: int) -> str:
    return _encode_cursor(max(0, offset))


def decode_cursor(cursor: str) -> int:
    return _decode_cursor(cursor)


def _total_pages(total: int, page_size: int) -> int:
    if total == 0:
        return 0
    return math.ceil(total / page_size)


def _encode_cursor(offset: int) -> str:
    payload = json.dumps({"offset": offset}, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(payload).decode().rstrip("=")


def _decode_cursor(cursor: str) -> int:
    try:
        padding = "=" * (-len(cursor) % 4)
        payload = base64.urlsafe_b64decode(f"{cursor}{padding}".encode())
        data = json.loads(payload)
        offset = data["offset"]
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise ValueError("Invalid pagination cursor") from exc
    if not isinstance(offset, int) or offset < 0:
        raise ValueError("Invalid pagination cursor")
    return offset
