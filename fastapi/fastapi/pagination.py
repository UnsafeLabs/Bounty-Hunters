import base64
import json
import math
from typing import Annotated, Any, Generic, TypeVar

from fastapi import Query
from pydantic import BaseModel, ConfigDict

T = TypeVar("T")

_DEFAULT_PAGE = 1
_DEFAULT_PAGE_SIZE = 20
_MAX_PAGE_SIZE = 100


class Paginator(BaseModel):
    page: Annotated[
        int,
        Query(
            ge=1,
            description="Page number (1-indexed)",
        ),
    ] = _DEFAULT_PAGE
    page_size: Annotated[
        int,
        Query(
            ge=1,
            le=_MAX_PAGE_SIZE,
            description="Number of items per page",
        ),
    ] = _DEFAULT_PAGE_SIZE

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size

    @property
    def limit(self) -> int:
        return self.page_size


class PaginatedResponse(BaseModel, Generic[T]):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    items: list[T]
    total: int
    page: int
    page_size: int
    total_pages: int
    has_next: bool
    has_previous: bool
    next_cursor: str | None = None
    previous_cursor: str | None = None

    @classmethod
    def create(
        cls,
        items: list[T],
        total: int,
        page: int,
        page_size: int,
    ) -> "PaginatedResponse[T]":
        total_pages = math.ceil(total / page_size) if page_size > 0 else 0
        has_next = page < total_pages
        has_previous = page > 1
        next_cursor = _encode_cursor(page + 1, page_size) if has_next else None
        previous_cursor = _encode_cursor(page - 1, page_size) if has_previous else None
        return cls(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=total_pages,
            has_next=has_next,
            has_previous=has_previous,
            next_cursor=next_cursor,
            previous_cursor=previous_cursor,
        )


class CursorParams(BaseModel):
    cursor: Annotated[
        str | None,
        Query(
            description="Encoded cursor for cursor-based pagination",
        ),
    ] = None
    page_size: Annotated[
        int,
        Query(
            ge=1,
            le=_MAX_PAGE_SIZE,
            description="Number of items per page",
        ),
    ] = _DEFAULT_PAGE_SIZE

    @property
    def decoded_page(self) -> int:
        if self.cursor is None:
            return 1
        return _decode_cursor(self.cursor).get("page", 1)

    @property
    def decoded_page_size(self) -> int:
        if self.cursor is None:
            return self.page_size
        return _decode_cursor(self.cursor).get("page_size", self.page_size)


def _encode_cursor(page: int, page_size: int) -> str:
    payload = json.dumps({"page": page, "page_size": page_size})
    return base64.urlsafe_b64encode(payload.encode()).decode()


def _decode_cursor(cursor: str) -> dict[str, int]:
    try:
        payload = base64.urlsafe_b64decode(cursor.encode()).decode()
        return json.loads(payload)
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
        return {"page": 1, "page_size": _DEFAULT_PAGE_SIZE}


def paginate(
    items: list[T],
    total: int,
    *,
    page: int = _DEFAULT_PAGE,
    page_size: int = _DEFAULT_PAGE_SIZE,
) -> PaginatedResponse[T]:
    return PaginatedResponse.create(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )
