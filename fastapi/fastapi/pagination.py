"""FastAPI pagination utility with offset and cursor-based pagination.

Provides a dependency-injectable pagination system that works with any
data source and returns standardized paginated responses.
"""

from __future__ import annotations

import base64 as _base64
import json as _json
from typing import Annotated, Any, Generic, Optional, TypeVar

from pydantic import BaseModel

from .param_functions import Query

T = TypeVar("T")


class PaginationParams:
    """Dependency-injectable pagination parameters."""

    def __init__(
        self,
        page: int = 1,
        page_size: int = 20,
        cursor: Optional[str] = None,
    ) -> None:
        self.page = max(1, page)
        self.page_size = max(1, min(page_size, 100))
        self.cursor = cursor

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size

    @property
    def limit(self) -> int:
        return self.page_size


class PaginatedResponse(BaseModel, Generic[T]):
    """Standardized paginated response model."""

    items: list[T]
    total: int
    page: int
    page_size: int
    total_pages: int
    has_next: bool
    has_previous: bool
    next_cursor: Optional[str] = None


def paginate(
    page: Annotated[
        int,
        Query(
            default=1,
            ge=1,
            description="Page number (1-based)",
        ),
    ] = 1,
    page_size: Annotated[
        int,
        Query(
            default=20,
            ge=1,
            le=100,
            description="Number of items per page",
        ),
    ] = 20,
) -> PaginationParams:
    """Dependency that extracts pagination parameters from query string.

    Can be injected into any FastAPI route:

    ```python
    @app.get("/items")
    def list_items(p: PaginationParams = Depends(paginate)):
        return paginator.paginate(...)
    ```
    """
    return PaginationParams(page=page, page_size=page_size)


class Paginator:
    """Utility for creating paginated responses from data sources."""

    @staticmethod
    def paginate_offset(
        items: list[Any],
        total: int,
        page: int,
        page_size: int,
    ) -> dict[str, Any]:
        """Build an offset-based paginated response dict.

        Args:
            items: The items for the current page.
            total: Total number of items across all pages.
            page: Current page number (1-based, will be clamped to >= 1).
            page_size: Number of items per page (will be clamped to >= 1).

        Returns:
            A dict matching the PaginatedResponse schema.
        """
        page = max(1, page)
        page_size = max(1, page_size)
        total_pages = max(1, (total + page_size - 1) // page_size) if total > 0 else 1

        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
            "has_next": page < total_pages,
            "has_previous": page > 1,
        }

    @staticmethod
    def paginate_cursor(
        items: list[Any],
        page_size: int,
        cursor_field: str = "id",
        cursor: Optional[str] = None,
    ) -> dict[str, Any]:
        """Build a cursor-based paginated response dict.

        The cursor encodes the value of ``cursor_field`` from the last
        item in the current page so the client can pass it back to request
        the next page.

        Args:
            items: The items for the current page (should contain one extra
                   item to detect has_next).
            page_size: Requested page size.
            cursor_field: The field to use as the cursor value.
            cursor: The cursor from the request (ignored in response, used
                    by the caller for filtering).

        Returns:
            A dict matching the PaginatedResponse schema.
        """
        page_size = max(1, page_size)

        has_next = len(items) > page_size
        if has_next:
            items = items[:page_size]

        next_cursor: Optional[str] = None
        if has_next and items:
            last_item = items[-1]
            cursor_value = None
            if isinstance(last_item, dict):
                cursor_value = last_item.get(cursor_field)
            elif hasattr(last_item, cursor_field):
                cursor_value = getattr(last_item, cursor_field)

            if cursor_value is not None:
                cursor_data = _json.dumps(
                    {cursor_field: cursor_value, "page_size": page_size}
                )
                next_cursor = _base64.urlsafe_b64encode(
                    cursor_data.encode()
                ).decode().rstrip("=")

        return {
            "items": items,
            "total": len(items),
            "page": 1,
            "page_size": page_size,
            "total_pages": 1,
            "has_next": has_next,
            "has_previous": False,
            "next_cursor": next_cursor,
        }

    @staticmethod
    def decode_cursor(cursor: str) -> dict[str, Any]:
        """Decode a cursor string back to its original data.

        Returns the decoded dict, or an empty dict if decoding fails.
        """
        try:
            padding = 4 - len(cursor) % 4
            if padding != 4:
                cursor += "=" * padding
            data = _base64.urlsafe_b64decode(cursor)
            return _json.loads(data)
        except Exception:
            return {}

    async def __aiter__(self):
        """Async iterator for use in async contexts.

        Usage:
            paginator = Paginator(query, limit=20)
            async for item in paginator:
                await process(item)
        """
        while True:
            page = self.next_page()
            if not page.items:
                break
            for item in page.items:
                yield item

