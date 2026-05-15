import base64
import binascii
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
    def __init__(
        self,
        *,
        page: int = 1,
        page_size: int = 20,
        cursor: str | None = None,
        max_page_size: int = 100,
    ) -> None:
        self.default_page_size = self._positive_int(page_size, default=20)
        self.max_page_size = self._positive_int(max_page_size, default=100)
        self.page_size = min(self.default_page_size, self.max_page_size)
        self.cursor = cursor
        self.page = self._positive_int(page, default=1)
        self.offset = self._offset_from_cursor(cursor)
        if cursor is None:
            self.offset = (self.page - 1) * self.page_size
        else:
            self.page = (self.offset // self.page_size) + 1

    @property
    def skip(self) -> int:
        return self.offset

    @property
    def limit(self) -> int:
        return self.page_size

    def apply_to_query(self, query: Any) -> Any:
        return query.offset(self.offset).limit(self.limit)

    def paginate_query(
        self, query: Any, *, total: int | None = None, cursor: bool = False
    ) -> PaginatedResponse[Any]:
        if total is None:
            total = int(query.count())
        paginated_query = self.apply_to_query(query)
        all_method = getattr(paginated_query, "all", None)
        items = all_method() if all_method is not None else list(paginated_query)
        return self.create_response(items, total=total, cursor=cursor)

    def paginate_sequence(
        self, items: Sequence[T], *, total: int | None = None, cursor: bool = False
    ) -> PaginatedResponse[T]:
        if total is None:
            total = len(items)
        page_items = list(items[self.offset : self.offset + self.limit])
        return self.create_response(page_items, total=total, cursor=cursor)

    def create_response(
        self, items: Sequence[T], *, total: int, cursor: bool = False
    ) -> PaginatedResponse[T]:
        safe_total = max(total, 0)
        total_pages = math.ceil(safe_total / self.page_size) if safe_total else 0
        has_next = self.offset + self.page_size < safe_total
        has_previous = safe_total > 0 and self.offset > 0
        next_cursor = (
            self.encode_cursor(self.offset + self.page_size) if has_next else None
        )
        previous_offset = max(0, self.offset - self.page_size)
        previous_cursor = self.encode_cursor(previous_offset) if has_previous else None
        return PaginatedResponse(
            items=list(items),
            total=safe_total,
            page=self.page,
            page_size=self.page_size,
            total_pages=total_pages,
            has_next=has_next,
            has_previous=has_previous,
            next_cursor=next_cursor if cursor else None,
            previous_cursor=previous_cursor if cursor else None,
        )

    @classmethod
    def encode_cursor(cls, offset: int) -> str:
        payload = {"offset": max(offset, 0)}
        encoded = base64.urlsafe_b64encode(json.dumps(payload).encode())
        return encoded.decode().rstrip("=")

    @classmethod
    def decode_cursor(cls, cursor: str | None) -> int:
        if not cursor:
            return 0
        try:
            padded_cursor = cursor + "=" * (-len(cursor) % 4)
            payload = base64.urlsafe_b64decode(padded_cursor.encode()).decode()
            data = json.loads(payload)
            return max(int(data.get("offset", 0)), 0)
        except (binascii.Error, TypeError, UnicodeDecodeError, ValueError):
            return 0

    def _offset_from_cursor(self, cursor: str | None) -> int:
        return self.decode_cursor(cursor)

    @staticmethod
    def _positive_int(value: int, *, default: int) -> int:
        try:
            int_value = int(value)
        except (TypeError, ValueError):
            return default
        return int_value if int_value > 0 else default


def paginate(
    page: Annotated[
        int,
        Query(
            description="One-based page number for offset pagination.",
        ),
    ] = 1,
    page_size: Annotated[
        int,
        Query(
            description="Number of items to return per page.",
        ),
    ] = 20,
    cursor: Annotated[
        str | None,
        Query(
            description="Encoded cursor for cursor pagination.",
        ),
    ] = None,
) -> Paginator:
    return Paginator(page=page, page_size=page_size, cursor=cursor)
