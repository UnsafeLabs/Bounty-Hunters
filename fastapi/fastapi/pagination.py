"""Standardized pagination for FastAPI.

Provides offset-based and cursor-based pagination that works with any
SQLAlchemy or Pydantic-based data source, returning standardized
paginated responses via dependency injection.
"""

from __future__ import annotations

import base64
import json
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, Field
from typing_extensions import Annotated

from fastapi import Depends, Query

T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    """Standardized paginated response wrapping any Pydantic model."""

    items: list[T] = Field(default_factory=list)
    total: int = Field(default=0, ge=0)
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1)
    total_pages: int = Field(default=0, ge=0)
    has_next: bool = Field(default=False)
    has_previous: bool = Field(default=False)


class CursorPaginatedResponse(BaseModel, Generic[T]):
    """Cursor-based paginated response with opaque cursor navigation."""

    items: list[T] = Field(default_factory=list)
    total: int = Field(default=0, ge=0)
    next_cursor: str | None = Field(default=None)
    previous_cursor: str | None = Field(default=None)
    has_next: bool = Field(default=False)
    has_previous: bool = Field(default=False)


class OffsetParams:
    """Dependency-injectable offset pagination parameters.

    Usage:
        @app.get("/items")
        def list_items(pagination: OffsetParams = Depends()):
            ...
    """

    def __init__(
        self,
        page: Annotated[
            int,
            Query(
                ge=1,
                description="Page number (1-indexed)",
            ),
        ] = 1,
        page_size: Annotated[
            int,
            Query(
                ge=1,
                le=100,
                description="Number of items per page",
            ),
        ] = 20,
    ) -> None:
        self.page = page
        self.page_size = page_size

    @property
    def offset(self) -> int:
        """Calculated offset for SQL / slice operations."""
        return (self.page - 1) * self.page_size

    @property
    def limit(self) -> int:
        """Alias for page_size — commonly used in ORMs."""
        return self.page_size


class CursorParams:
    """Dependency-injectable cursor pagination parameters.

    Usage:
        @app.get("/items")
        def list_items(pagination: CursorParams = Depends()):
            ...
    """

    def __init__(
        self,
        cursor: Annotated[
            str | None,
            Query(
                description="Opaque cursor for the next/previous page",
            ),
        ] = None,
        page_size: Annotated[
            int,
            Query(
                ge=1,
                le=100,
                description="Number of items per page",
            ),
        ] = 20,
        direction: Annotated[
            str,
            Query(
                pattern="^(next|previous)$",
                description="Pagination direction: 'next' or 'previous'",
            ),
        ] = "next",
    ) -> None:
        self.cursor = cursor
        self.page_size = page_size
        self.direction = direction

    def decode_cursor(self) -> dict[str, Any] | None:
        """Decode the opaque cursor into its constituent values."""
        if self.cursor is None:
            return None
        try:
            decoded = base64.urlsafe_b64decode(self.cursor.encode()).decode()
            return json.loads(decoded)
        except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
            return None

    @staticmethod
    def encode_cursor(data: dict[str, Any]) -> str:
        """Encode a dictionary into an opaque cursor string."""
        raw = json.dumps(data, separators=(",", ":"), sort_keys=True)
        return base64.urlsafe_b64encode(raw.encode()).decode()


class Paginator:
    """Applies offset-based pagination to an iterable of items.

    This is a utility class for use within route handlers when you
    have fetched data from a database or external source and want
    to produce a ``PaginatedResponse``.

    Usage:
        items = db.query(MyModel).all()
        paginator = Paginator(items, offset_params)
        return paginator.response()

        # With a custom Pydantic model
        return paginator.response(model=MySchema)
    """

    def __init__(
        self,
        items: list[Any],
        params: OffsetParams,
    ) -> None:
        self._all_items = items
        self._params = params

    @property
    def total(self) -> int:
        return len(self._all_items)

    @property
    def total_pages(self) -> int:
        if self._params.page_size == 0:
            return 0
        return max(1, (self.total + self._params.page_size - 1) // self._params.page_size)

    @property
    def page_items(self) -> list[Any]:
        start = self._params.offset
        end = start + self._params.limit
        return self._all_items[start:end]

    def _convert_item(self, item: Any, model: type[BaseModel]) -> BaseModel:
        """Convert a raw item to the target Pydantic model."""
        if isinstance(item, model):
            return item
        if isinstance(item, BaseModel):
            return model.model_validate(item.model_dump())
        if isinstance(item, dict):
            return model.model_validate(item)
        return model.model_validate(item)

    def response(self, *, model: type[BaseModel] | None = None) -> PaginatedResponse[Any]:
        """Build the standardized ``PaginatedResponse``.

        If ``model`` is provided, each item is validated and serialized
        through the Pydantic model. Otherwise raw items are returned.
        """
        items = self.page_items
        if model is not None:
            items = [self._convert_item(item, model) for item in items]

        return PaginatedResponse(
            items=items,
            total=self.total,
            page=self._params.page,
            page_size=self._params.page_size,
            total_pages=self.total_pages,
            has_next=self._params.page < self.total_pages,
            has_previous=self._params.page > 1,
        )


class CursorPaginator:
    """Applies cursor-based pagination to a sorted iterable.

    Items must be sorted by a unique, monotonically-ordered field
    (e.g. ``id``, ``created_at``). The cursor encodes the field
    value of the boundary item.

    Usage:
        items = sorted(db.query(MyModel).all(), key=lambda x: x.id)
        paginator = CursorPaginator(items, cursor_params, cursor_field="id")
        return paginator.response()
    """

    def __init__(
        self,
        items: list[Any],
        params: CursorParams,
        cursor_field: str = "id",
    ) -> None:
        if not items:
            self._all_items: list[Any] = []
        else:
            # Ensure items are sortable by cursor_field
            self._all_items = sorted(items, key=lambda x: getattr(x, cursor_field))

        self._params = params
        self._cursor_field = cursor_field

    @property
    def total(self) -> int:
        return len(self._all_items)

    @property
    def page_items(self) -> list[Any]:
        if not self._all_items:
            return []

        decoded = self._params.decode_cursor()
        limit = self._params.page_size

        if decoded is not None and self._cursor_field in decoded:
            cursor_value = decoded[self._cursor_field]
            if self._params.direction == "next":
                # Return items AFTER the cursor value, ascending
                items = [i for i in self._all_items if getattr(i, self._cursor_field) > cursor_value]
                return items[:limit]
            else:
                # Return items BEFORE the cursor value — take the
                # *last* `limit` items so they appear in natural order.
                items = [i for i in self._all_items if getattr(i, self._cursor_field) < cursor_value]
                return items[-limit:] if len(items) > limit else items

        # No cursor — return first page
        return self._all_items[:limit]

    @property
    def has_next(self) -> bool:
        items = self.page_items
        if not items or not self._all_items:
            return False
        last_in_page = getattr(items[-1], self._cursor_field)
        last_overall = getattr(self._all_items[-1], self._cursor_field)
        return last_in_page < last_overall

    @property
    def has_previous(self) -> bool:
        decoded = self._params.decode_cursor()
        if decoded is None:
            return False
        if self._params.direction == "next":
            # If we have a cursor, there are items before it
            if not self._all_items:
                return False
            first_overall = getattr(self._all_items[0], self._cursor_field)
            return decoded.get(self._cursor_field, first_overall) > first_overall
        # For "previous" direction, there may be more before
        items = self.page_items
        if not items or not self._all_items:
            return False
        first_in_page = getattr(items[0], self._cursor_field)
        first_overall = getattr(self._all_items[0], self._cursor_field)
        return first_in_page > first_overall

    def _build_cursor(self, item: Any) -> str:
        return self._params.encode_cursor({self._cursor_field: getattr(item, self._cursor_field)})

    def _convert_item(self, item: Any, model: type[BaseModel]) -> BaseModel:
        """Convert a raw item to the target Pydantic model."""
        if isinstance(item, model):
            return item
        if isinstance(item, BaseModel):
            return model.model_validate(item.model_dump())
        if isinstance(item, dict):
            return model.model_validate(item)
        return model.model_validate(item)

    def response(
        self, *, model: type[BaseModel] | None = None
    ) -> CursorPaginatedResponse[Any]:
        """Build the standardized ``CursorPaginatedResponse``."""
        items = self.page_items
        if model is not None:
            items = [self._convert_item(item, model) for item in items]

        next_cursor: str | None = None
        previous_cursor: str | None = None

        if items:
            # Next cursor points to the last item in this page
            next_cursor = self._build_cursor(items[-1]) if self.has_next else None
            # Previous cursor points to the first item in this page
            previous_cursor = self._build_cursor(items[0]) if self.has_previous else None

        return CursorPaginatedResponse(
            items=items,
            total=self.total,
            next_cursor=next_cursor,
            previous_cursor=previous_cursor,
            has_next=self.has_next,
            has_previous=self.has_previous,
        )


def paginate(
    params: Annotated[OffsetParams, Depends()],
) -> OffsetParams:
    """Dependency that injects ``OffsetParams`` into any route.

    Usage:
        @app.get("/items")
        def list_items(pagination: OffsetParams = Depends(paginate)):
            items = get_all_items()
            paginator = Paginator(items, pagination)
            return paginator.response()
    """
    return params


def paginate_cursor(
    params: Annotated[CursorParams, Depends()],
) -> CursorParams:
    """Dependency that injects ``CursorParams`` into any route.

    Usage:
        @app.get("/items/cursor")
        def list_items_cursor(pagination: CursorParams = Depends(paginate_cursor)):
            items = get_all_items()
            paginator = CursorPaginator(items, pagination)
            return paginator.response()
    """
    return params
