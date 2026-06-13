"""
FastAPI pagination utilities with offset-based and cursor-based pagination support.

Provides a `Paginator` class, generic response models, and a `paginate`
dependency injection function that can be used in any FastAPI route.

## Example

```python
from typing import Annotated

from fastapi import FastAPI, Depends
from fastapi.pagination import PaginatedResponse, paginate, Paginator

app = FastAPI()


@app.get("/items", response_model=PaginatedResponse[Item])
async def list_items(params: Annotated[Paginator, Depends(paginate)]):
    items, total = get_items(skip=params.skip, limit=params.limit)
    return params.response(items, total)
```
"""

from collections.abc import Callable, Sequence
from math import ceil
from typing import Annotated, Any, Generic, TypeVar

from fastapi import Query
from pydantic import BaseModel

T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    """
    Standard offset-based paginated response.

    Wraps a list of items with pagination metadata.
    """

    items: list[T]
    """The list of items for the current page."""
    total: int
    """Total number of items across all pages."""
    page: int
    """Current page number (1-based)."""
    page_size: int
    """Number of items per page."""
    total_pages: int
    """Total number of pages."""
    has_next: bool
    """Whether there is a next page after this one."""
    has_previous: bool
    """Whether there is a previous page before this one."""


class CursorPaginatedResponse(BaseModel, Generic[T]):
    """
    Cursor-based paginated response.

    Uses opaque cursor strings for navigation instead of page numbers.
    """

    items: list[T]
    """The list of items for the current page."""
    cursor: str | None = None
    """The cursor used to retrieve this page."""
    next_cursor: str | None = None
    """Cursor to retrieve the next page (null if on the last page)."""
    previous_cursor: str | None = None
    """Cursor to retrieve the previous page (null if on the first page)."""
    has_next: bool
    """Whether there is a next page after this one."""
    has_previous: bool
    """Whether there is a previous page before this one."""


class Paginator:
    """
    Pagination helper that holds the current pagination parameters.

    Once instantiated via the `paginate` dependency, provides convenience
    methods to build paginated responses.
    """

    def __init__(self, page: int, page_size: int) -> None:
        if page < 0:
            page = 1
        if page_size <= 0:
            page_size = 20
        self.page = max(page, 1)
        self.page_size = page_size
        self.skip = (self.page - 1) * self.page_size
        self.limit = self.page_size

    def response(self, items: Sequence[T], total: int) -> PaginatedResponse[T]:
        """
        Build an offset-based paginated response.

        Args:
            items: The items for the current page.
            total: The total number of items across all pages.

        Returns:
            A `PaginatedResponse` with pagination metadata.
        """
        total_pages = max(ceil(total / self.page_size), 1) if total > 0 else 1
        return PaginatedResponse(
            items=list(items),
            total=total,
            page=self.page,
            page_size=self.page_size,
            total_pages=total_pages,
            has_next=self.page < total_pages,
            has_previous=self.page > 1,
        )

    @staticmethod
    def paginate_offset(
        items: Sequence[T],
        total: int,
        page: int,
        page_size: int,
    ) -> PaginatedResponse[T]:
        """
        Create an offset-based paginated response from raw parameters.

        Args:
            items: The items for the current page.
            total: The total number of items across all pages.
            page: Current page number (1-based).
            page_size: Number of items per page.

        Returns:
            A `PaginatedResponse` with pagination metadata.
        """
        safe_page = max(page, 1)
        safe_page_size = max(page_size, 1)
        total_pages = max(ceil(total / safe_page_size), 1) if total > 0 else 1
        return PaginatedResponse(
            items=list(items),
            total=total,
            page=safe_page,
            page_size=safe_page_size,
            total_pages=total_pages,
            has_next=safe_page < total_pages,
            has_previous=safe_page > 1,
        )

    @staticmethod
    def paginate_cursor(
        items: Sequence[T],
        cursor: str | None,
        page_size: int,
        encode_cursor: Callable[[Any], str] | None = None,
        decode_cursor: Callable[[str], Any] | None = None,
        has_more: bool = False,
        previous_cursor: str | None = None,
    ) -> CursorPaginatedResponse[T]:
        """
        Create a cursor-based paginated response.

        Args:
            items: The items for the current page.
            cursor: The cursor used to retrieve this page.
            page_size: Number of items per page.
            encode_cursor: Optional function to encode a cursor value into a string.
            decode_cursor: Optional function to decode a cursor string into a value.
            has_more: Whether there are more items after this page.
            previous_cursor: Optional cursor for navigating back.

        Returns:
            A `CursorPaginatedResponse` with cursor navigation metadata.
        """
        import base64
        import json

        def _default_encode(value: Any) -> str:
            return base64.urlsafe_b64encode(
                json.dumps(value).encode()
            ).decode().rstrip("=")

        def _default_decode(value: str) -> Any:
            padded = value + "=" * (4 - len(value) % 4) if len(value) % 4 else value
            return json.loads(base64.urlsafe_b64decode(padded))

        encode = encode_cursor or _default_encode
        next_cursor_value: str | None = None

        if has_more and len(items) > 0:
            last_item = items[-1]
            next_cursor_value = encode(last_item)

        return CursorPaginatedResponse(
            items=list(items),
            cursor=cursor,
            next_cursor=next_cursor_value,
            previous_cursor=previous_cursor,
            has_next=has_more,
            has_previous=previous_cursor is not None,
        )


async def paginate(
    page: Annotated[int, Query(ge=1, description="Page number (1-based)")] = 1,
    page_size: Annotated[
        int, Query(ge=1, le=1000, description="Number of items per page")
    ] = 20,
) -> Paginator:
    """
    FastAPI dependency that provides pagination parameters.

    Usage:

    ```python
    from typing import Annotated
    from fastapi import Depends
    from fastapi.pagination import paginate, Paginator

    @app.get("/items")
    async def list_items(params: Annotated[Paginator, Depends(paginate)]):
        items = get_items(skip=params.skip, limit=params.limit)
        return params.response(items, len(items))
    ```

    Query parameters:
    - **page**: Page number (1-based, default: 1)
    - **page_size**: Number of items per page (default: 20, max: 1000)
    """
    return Paginator(page=page, page_size=page_size)
