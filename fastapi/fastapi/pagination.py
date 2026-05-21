import base64
from collections.abc import Sequence
from typing import Generic, TypeVar

from fastapi import Query
from pydantic import BaseModel

ItemType = TypeVar("ItemType")


class PaginatedResponse(BaseModel, Generic[ItemType]):
    """Standardized paginated response wrapping any Pydantic model.

    Usage:
        ```python
        from fastapi.pagination import PaginatedResponse, PaginationParams, paginate

        @app.get("/items", response_model=PaginatedResponse[Item])
        def list_items(params: PaginationParams = Depends()):
            items, total = get_items(skip=params.skip, limit=params.limit)
            return paginate(items, total, params)
        ```
    """

    items: list[ItemType]
    total: int
    page: int
    page_size: int
    total_pages: int
    has_next: bool
    has_previous: bool


class PaginationParams:
    """Offset-based pagination query parameters.

    Injected as a FastAPI dependency. Provides ``page``, ``page_size``,
    ``skip``, and ``limit`` for easy offset/limit computation.
    """

    def __init__(
        self,
        page: int = Query(1, ge=1, description="Page number, 1-indexed"),
        page_size: int = Query(
            20, ge=1, le=100, description="Number of items per page"
        ),
    ) -> None:
        self.page = page
        self.page_size = page_size
        self.skip = (page - 1) * page_size
        self.limit = page_size


class CursorParams:
    """Cursor-based pagination query parameters.

    Injected as a FastAPI dependency. Clients pass the ``cursor`` returned
    by the previous response to fetch the next page.
    """

    def __init__(
        self,
        cursor: str | None = Query(None, description="Cursor from previous page"),
        limit: int = Query(20, ge=1, le=100, description="Number of items per page"),
    ) -> None:
        self.cursor = cursor
        self.limit = limit


class CursorPage(BaseModel, Generic[ItemType]):
    """Cursor-based paginated response.

    Returns the page of items along with a ``cursor`` that can be passed
    as the ``cursor`` query parameter to get the next page.
    """

    items: list[ItemType]
    cursor: str | None = None
    limit: int
    has_next: bool


def paginate(
    items: Sequence[ItemType],
    total: int,
    params: PaginationParams,
) -> PaginatedResponse[ItemType]:
    """Wrap items into a :class:`PaginatedResponse`.

    Args:
        items: The items for the current page.
        total: Total number of items across all pages.
        params: The :class:`PaginationParams` from the request.
    """
    if total <= 0:
        return PaginatedResponse(
            items=[], total=0, page=params.page, page_size=params.page_size,
            total_pages=0, has_next=False, has_previous=False,
        )
    total_pages = max(1, (total + params.page_size - 1) // params.page_size)
    return PaginatedResponse(
        items=list(items),
        total=total,
        page=params.page,
        page_size=params.page_size,
        total_pages=total_pages,
        has_next=params.page < total_pages,
        has_previous=params.page > 1,
    )


def encode_cursor(value: str | int) -> str:
    """Encode a value as an opaque, URL-safe cursor string."""
    return base64.urlsafe_b64encode(str(value).encode()).decode()


def decode_cursor(cursor: str) -> str:
    """Decode a cursor string back to its original value."""
    return base64.urlsafe_b64decode(cursor.encode()).decode()
