import base64
import json
import math
from collections.abc import Sequence
from typing import Annotated, Any, Generic, TypeVar

from pydantic import BaseModel, Field

from .param_functions import Query

T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    items: list[T]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)
    total_pages: int = Field(ge=0)
    has_next: bool
    has_previous: bool
    next_cursor: str | None = None
    previous_cursor: str | None = None


class Paginator:
    default_page_size = 50
    max_page_size = 100

    def __init__(
        self,
        page: int = 1,
        page_size: int = default_page_size,
        cursor: str | None = None,
    ) -> None:
        self.page = max(1, page)
        self.page_size = self._normalize_page_size(page_size)
        self.cursor = cursor

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size

    @property
    def limit(self) -> int:
        return self.page_size

    def apply_offset(self, source: Any) -> Any:
        if hasattr(source, "offset") and hasattr(source, "limit"):
            return source.offset(self.offset).limit(self.limit)
        return source[self.offset : self.offset + self.limit]

    def paginate_offset(
        self,
        items: Sequence[T],
        total: int | None = None,
    ) -> PaginatedResponse[T]:
        resolved_total = len(items) if total is None else max(0, total)
        page_items = list(items[self.offset : self.offset + self.page_size])
        return self._build_response(
            items=page_items,
            total=resolved_total,
            page=self.page,
            offset=self.offset,
        )

    def paginate_cursor(
        self,
        items: Sequence[T],
        total: int | None = None,
    ) -> PaginatedResponse[T]:
        offset = self.decode_cursor(self.cursor) if self.cursor else 0
        resolved_total = len(items) if total is None else max(0, total)
        page = offset // self.page_size + 1
        page_items = list(items[offset : offset + self.page_size])
        return self._build_response(
            items=page_items,
            total=resolved_total,
            page=page,
            offset=offset,
            include_cursors=True,
        )

    def _build_response(
        self,
        *,
        items: list[T],
        total: int,
        page: int,
        offset: int,
        include_cursors: bool = False,
    ) -> PaginatedResponse[T]:
        total_pages = math.ceil(total / self.page_size) if total else 0
        next_offset = offset + self.page_size
        previous_offset = max(0, offset - self.page_size)
        has_next = next_offset < total
        has_previous = offset > 0 and total > 0
        return PaginatedResponse[T](
            items=items,
            total=total,
            page=page,
            page_size=self.page_size,
            total_pages=total_pages,
            has_next=has_next,
            has_previous=has_previous,
            next_cursor=self.encode_cursor(next_offset) if include_cursors and has_next else None,
            previous_cursor=self.encode_cursor(previous_offset)
            if include_cursors and has_previous
            else None,
        )

    @classmethod
    def _normalize_page_size(cls, page_size: int) -> int:
        if page_size <= 0:
            return cls.default_page_size
        return min(page_size, cls.max_page_size)

    @staticmethod
    def encode_cursor(offset: int) -> str:
        payload = json.dumps({"offset": max(0, offset)}, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(payload).decode().rstrip("=")

    @staticmethod
    def decode_cursor(cursor: str) -> int:
        try:
            padded = cursor + "=" * (-len(cursor) % 4)
            payload = json.loads(base64.urlsafe_b64decode(padded.encode()))
            return max(0, int(payload.get("offset", 0)))
        except (ValueError, TypeError, json.JSONDecodeError):
            return 0


def paginate(
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: Annotated[str | None, Query()] = None,
) -> Paginator:
    return Paginator(page=page, page_size=page_size, cursor=cursor)
