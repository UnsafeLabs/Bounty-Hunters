import base64
import json
from collections.abc import Sequence
from math import ceil
from typing import Annotated, Any, Generic, TypeVar

from fastapi.param_functions import Query
from pydantic import BaseModel

ItemT = TypeVar("ItemT")

DEFAULT_PAGE = 1
DEFAULT_PAGE_SIZE = 50
DEFAULT_MAX_PAGE_SIZE = 100


class PaginationParams(BaseModel):
    page: int = DEFAULT_PAGE
    page_size: int = DEFAULT_PAGE_SIZE
    cursor: str | None = None


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


def _normalize_page(page: int) -> int:
    return max(page, DEFAULT_PAGE)


def _normalize_page_size(
    page_size: int,
    *,
    max_page_size: int = DEFAULT_MAX_PAGE_SIZE,
) -> int:
    if page_size <= 0:
        return DEFAULT_PAGE_SIZE
    return min(page_size, max_page_size)


def _total_pages(total: int, page_size: int) -> int:
    if total <= 0:
        return 0
    return ceil(total / page_size)


def paginate(
    page: Annotated[int, Query(description="Page number, starting at 1")] = 1,
    page_size: Annotated[int, Query(description="Number of items per page")] = 50,
    cursor: Annotated[str | None, Query(description="Opaque pagination cursor")] = None,
) -> PaginationParams:
    return PaginationParams(
        page=_normalize_page(page),
        page_size=_normalize_page_size(page_size),
        cursor=cursor,
    )


class Paginator:
    def __init__(
        self,
        *,
        page: int = DEFAULT_PAGE,
        page_size: int = DEFAULT_PAGE_SIZE,
        cursor: str | None = None,
        max_page_size: int = DEFAULT_MAX_PAGE_SIZE,
    ):
        self.page = _normalize_page(page)
        self.page_size = _normalize_page_size(
            page_size,
            max_page_size=max_page_size,
        )
        self.cursor = cursor

    @property
    def skip(self) -> int:
        return (self.page - 1) * self.page_size

    @property
    def limit(self) -> int:
        return self.page_size

    @staticmethod
    def encode_cursor(offset: int) -> str:
        payload = json.dumps({"offset": max(0, offset)}, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(payload).decode().rstrip("=")

    @staticmethod
    def decode_cursor(cursor: str | None) -> int:
        if not cursor:
            return 0
        try:
            padding = "=" * (-len(cursor) % 4)
            payload = base64.urlsafe_b64decode(f"{cursor}{padding}".encode())
            offset = json.loads(payload.decode()).get("offset", 0)
            return max(0, int(offset))
        except (ValueError, json.JSONDecodeError):
            return 0

    def paginate(
        self, source: Any, *, total: int | None = None
    ) -> PaginatedResponse[Any]:
        if _is_query_like(source):
            resolved_total = int(source.count() if total is None else total)
            items = list(source.offset(self.skip).limit(self.limit).all())
        else:
            sequence = list(source)
            resolved_total = len(sequence) if total is None else int(total)
            items = sequence[self.skip : self.skip + self.limit]
        total_pages = _total_pages(resolved_total, self.page_size)
        return PaginatedResponse(
            items=items,
            total=resolved_total,
            page=self.page,
            page_size=self.page_size,
            total_pages=total_pages,
            has_next=self.page < total_pages,
            has_previous=self.page > 1 and resolved_total > 0,
        )

    def paginate_cursor(
        self,
        source: Sequence[ItemT],
        *,
        cursor: str | None = None,
    ) -> PaginatedResponse[ItemT]:
        resolved_cursor = self.cursor if cursor is None else cursor
        start = self.decode_cursor(resolved_cursor)
        total = len(source)
        end = start + self.page_size
        items = list(source[start:end])
        has_next = end < total
        has_previous = start > 0 and total > 0
        page = start // self.page_size + 1
        total_pages = _total_pages(total, self.page_size)
        return PaginatedResponse(
            items=items,
            total=total,
            page=page,
            page_size=self.page_size,
            total_pages=total_pages,
            has_next=has_next,
            has_previous=has_previous,
            next_cursor=self.encode_cursor(end) if has_next else None,
            previous_cursor=self.encode_cursor(max(0, start - self.page_size))
            if has_previous
            else None,
        )


def _is_query_like(source: Any) -> bool:
    return all(hasattr(source, name) for name in ("count", "offset", "limit", "all"))
