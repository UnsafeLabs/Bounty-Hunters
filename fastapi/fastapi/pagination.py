"""Standardized pagination utilities.

This module provides reusable building blocks to paginate any SQLAlchemy or
Pydantic-based data source and return a consistent, well-typed response shape.

Two pagination styles are supported:

* **Offset pagination** (`Paginator` / `paginate`): classic ``page`` +
  ``page_size`` navigation. Exposes ``offset``/``skip``/``limit`` for use with
  ``LIMIT``/``OFFSET`` queries and reports ``total``, ``total_pages``,
  ``has_next`` and ``has_previous``.
* **Cursor pagination** (`CursorPaginator` / `paginate_cursor`): opaque,
  base64-encoded cursors for stable ``next``/``previous`` navigation.

Both styles can be injected into any route via FastAPI dependencies and wrap an
arbitrary Pydantic model through the generic `PaginatedResponse` /
`CursorPaginatedResponse` types.
"""

import base64
import binascii
import json
from collections.abc import Sequence
from typing import (
    Annotated,
    Any,
    Generic,
    TypeVar,
)

from annotated_doc import Doc
from fastapi.exceptions import HTTPException
from fastapi.param_functions import Query
from pydantic import BaseModel

ModelType = TypeVar("ModelType")

DEFAULT_PAGE = 1
"""Default page number when the client does not provide one."""

DEFAULT_PAGE_SIZE = 50
"""Default number of items per page."""

MAX_PAGE_SIZE = 100
"""Upper bound for ``page_size`` to protect the backend from huge queries."""


class PaginatedResponse(BaseModel, Generic[ModelType]):
    """
    A standardized, generic response model for offset-based pagination.

    Parameterize it with any Pydantic model (or scalar) to type the page items,
    e.g. ``PaginatedResponse[ItemModel]``.
    """

    items: Annotated[
        list[ModelType],
        Doc("The items contained in the current page."),
    ]
    total: Annotated[
        int,
        Doc("Total number of items across every page."),
    ]
    page: Annotated[
        int,
        Doc("The (normalized) current page number, starting at 1."),
    ]
    page_size: Annotated[
        int,
        Doc("The (normalized) number of items requested per page."),
    ]
    total_pages: Annotated[
        int,
        Doc("Total number of pages, ``0`` when there are no items."),
    ]
    has_next: Annotated[
        bool,
        Doc("Whether a page after the current one exists."),
    ]
    has_previous: Annotated[
        bool,
        Doc("Whether a page before the current one exists."),
    ]


class CursorPaginatedResponse(BaseModel, Generic[ModelType]):
    """
    A standardized, generic response model for cursor-based pagination.

    ``next_cursor`` / ``previous_cursor`` are opaque, base64-encoded tokens that
    should be passed back verbatim as the ``cursor`` query parameter to navigate.
    """

    items: Annotated[
        list[ModelType],
        Doc("The items contained in the current page."),
    ]
    page_size: Annotated[
        int,
        Doc("The (normalized) number of items requested per page."),
    ]
    total: Annotated[
        int,
        Doc("Total number of items across every page."),
    ]
    next_cursor: Annotated[
        str | None,
        Doc("Opaque cursor for the next page, or ``None`` at the end."),
    ]
    previous_cursor: Annotated[
        str | None,
        Doc("Opaque cursor for the previous page, or ``None`` at the start."),
    ]
    has_next: Annotated[
        bool,
        Doc("Whether a page after the current one exists."),
    ]
    has_previous: Annotated[
        bool,
        Doc("Whether a page before the current one exists."),
    ]


def _normalize_page_size(page_size: int, max_page_size: int) -> int:
    upper = max(1, max_page_size)
    if page_size < 1:
        page_size = DEFAULT_PAGE_SIZE
    return min(page_size, upper)


def encode_cursor(data: dict[str, Any]) -> str:
    """Encode a cursor payload into an opaque, URL-safe base64 token."""
    raw = json.dumps(data, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii")


def decode_cursor(cursor: str) -> dict[str, Any]:
    """
    Decode an opaque cursor produced by `encode_cursor`.

    Raises ``ValueError`` if the token is malformed.
    """
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii"))
        data = json.loads(raw)
    except (binascii.Error, ValueError, UnicodeError) as exc:
        raise ValueError("Invalid pagination cursor") from exc
    if not isinstance(data, dict):
        raise ValueError("Invalid pagination cursor")
    return data


class Paginator:
    """
    Offset-based paginator.

    Normalizes user-supplied ``page`` / ``page_size`` (clamping out-of-range or
    invalid values to sensible defaults), exposes ``offset``/``skip``/``limit``
    for slicing a data source, and builds a `PaginatedResponse` from the page
    items plus the total count.
    """

    def __init__(
        self,
        page: int = DEFAULT_PAGE,
        page_size: int = DEFAULT_PAGE_SIZE,
        *,
        max_page_size: int = MAX_PAGE_SIZE,
    ) -> None:
        self.max_page_size = max(1, max_page_size)
        self.page = page if page >= 1 else DEFAULT_PAGE
        self.page_size = _normalize_page_size(page_size, self.max_page_size)

    @property
    def offset(self) -> int:
        """Number of items to skip before the current page."""
        return (self.page - 1) * self.page_size

    @property
    def skip(self) -> int:
        """Alias for `offset`, matching common SQLAlchemy naming."""
        return self.offset

    @property
    def limit(self) -> int:
        """Maximum number of items to fetch for the current page."""
        return self.page_size

    def paginate(
        self,
        items: Sequence[ModelType],
        total: int,
    ) -> PaginatedResponse[ModelType]:
        """Build a `PaginatedResponse` from the current page items and total."""
        total = max(0, total)
        total_pages = (total + self.page_size - 1) // self.page_size
        has_previous = self.page > 1 and total > 0
        has_next = self.page < total_pages
        return PaginatedResponse(
            items=list(items),
            total=total,
            page=self.page,
            page_size=self.page_size,
            total_pages=total_pages,
            has_next=has_next,
            has_previous=has_previous,
        )


class CursorPaginator:
    """
    Cursor-based paginator.

    Decodes an opaque ``cursor`` into a starting offset, exposes
    ``offset``/``skip``/``limit`` for slicing a data source, and builds a
    `CursorPaginatedResponse` with freshly encoded ``next``/``previous`` cursors.
    """

    def __init__(
        self,
        cursor: str | None = None,
        page_size: int = DEFAULT_PAGE_SIZE,
        *,
        max_page_size: int = MAX_PAGE_SIZE,
    ) -> None:
        self.max_page_size = max(1, max_page_size)
        self.page_size = _normalize_page_size(page_size, self.max_page_size)
        self.offset = 0
        if cursor:
            try:
                payload = decode_cursor(cursor)
            except ValueError as exc:
                raise HTTPException(
                    status_code=400, detail="Invalid pagination cursor"
                ) from exc
            position = payload.get("offset", 0)
            if isinstance(position, int) and position > 0:
                self.offset = position

    @property
    def skip(self) -> int:
        """Alias for `offset`, matching common SQLAlchemy naming."""
        return self.offset

    @property
    def limit(self) -> int:
        """Maximum number of items to fetch for the current page."""
        return self.page_size

    def paginate(
        self,
        items: Sequence[ModelType],
        total: int,
    ) -> CursorPaginatedResponse[ModelType]:
        """Build a `CursorPaginatedResponse` from the page items and total."""
        total = max(0, total)
        items = list(items)
        start = self.offset
        end = start + len(items)
        has_previous = start > 0
        has_next = end < total
        next_cursor = encode_cursor({"offset": end}) if has_next else None
        previous_cursor = (
            encode_cursor({"offset": max(0, start - self.page_size)})
            if has_previous
            else None
        )
        return CursorPaginatedResponse(
            items=items,
            page_size=self.page_size,
            total=total,
            next_cursor=next_cursor,
            previous_cursor=previous_cursor,
            has_next=has_next,
            has_previous=has_previous,
        )


def paginate(
    page: Annotated[
        int,
        Query(description="Page number, starting at 1."),
    ] = DEFAULT_PAGE,
    page_size: Annotated[
        int,
        Query(description="Number of items per page."),
    ] = DEFAULT_PAGE_SIZE,
) -> Paginator:
    """
    FastAPI dependency that reads ``page`` and ``page_size`` from the query
    string (with sensible defaults) and returns a ready-to-use `Paginator`.

    Inject it into any route with ``pager: Annotated[Paginator, Depends(paginate)]``.
    """
    return Paginator(page=page, page_size=page_size)


def paginate_cursor(
    cursor: Annotated[
        str | None,
        Query(description="Opaque cursor returned by a previous response."),
    ] = None,
    page_size: Annotated[
        int,
        Query(description="Number of items per page."),
    ] = DEFAULT_PAGE_SIZE,
) -> CursorPaginator:
    """
    FastAPI dependency that reads ``cursor`` and ``page_size`` from the query
    string (with sensible defaults) and returns a ready-to-use `CursorPaginator`.

    Inject it into any route with
    ``pager: Annotated[CursorPaginator, Depends(paginate_cursor)]``.
    """
    return CursorPaginator(cursor=cursor, page_size=page_size)
