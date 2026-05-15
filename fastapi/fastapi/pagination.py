from __future__ import annotations

import base64
import binascii
import json
import math
from collections.abc import Iterable, Sequence
from typing import Annotated, Any, Generic, Literal, TypeVar, cast

from pydantic import BaseModel

from .exceptions import HTTPException
from .param_functions import Query

T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
    total_pages: int
    has_next: bool
    has_previous: bool
    next_cursor: str | None = None
    previous_cursor: str | None = None


class Paginator:
    def __init__(
        self,
        page: int = 1,
        page_size: int = 50,
        cursor: str | None = None,
        max_page_size: int = 100,
    ) -> None:
        if page < 1:
            raise ValueError("page must be greater than or equal to 1")
        if page_size < 1:
            raise ValueError("page_size must be greater than or equal to 1")
        if max_page_size < 1:
            raise ValueError("max_page_size must be greater than or equal to 1")
        if page_size > max_page_size:
            raise ValueError(f"page_size must be less than or equal to {max_page_size}")

        self.page = page
        self.page_size = page_size
        self.cursor = cursor
        self.max_page_size = max_page_size
        self._cursor_offset = self.decode_cursor(cursor) if cursor else None

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size

    @property
    def limit(self) -> int:
        return self.page_size

    @staticmethod
    def encode_cursor(offset: int) -> str:
        if offset < 0:
            raise ValueError("cursor offset must be greater than or equal to 0")
        payload = json.dumps({"offset": offset}, separators=(",", ":")).encode("utf-8")
        return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")

    @staticmethod
    def decode_cursor(cursor: str) -> int:
        try:
            padded_cursor = cursor + "=" * (-len(cursor) % 4)
            decoded = base64.urlsafe_b64decode(padded_cursor.encode("ascii"))
            payload = json.loads(decoded.decode("utf-8"))
            offset = payload["offset"]
        except (
            binascii.Error,
            KeyError,
            TypeError,
            ValueError,
            UnicodeDecodeError,
        ) as exc:
            raise ValueError("cursor must be a valid encoded pagination cursor") from exc

        if not isinstance(offset, int) or offset < 0:
            raise ValueError("cursor offset must be greater than or equal to 0")
        return offset

    def paginate(
        self,
        data_source: Sequence[T] | Iterable[T] | Any,
        *,
        total: int | None = None,
        mode: Literal["offset", "cursor"] = "offset",
        session: Any | None = None,
    ) -> PaginatedResponse[T]:
        if mode == "cursor":
            return self.paginate_cursor(data_source, total=total, session=session)
        if mode == "offset":
            return self.paginate_offset(data_source, total=total, session=session)
        raise ValueError("mode must be either 'offset' or 'cursor'")

    def paginate_offset(
        self,
        data_source: Sequence[T] | Iterable[T] | Any,
        *,
        total: int | None = None,
        session: Any | None = None,
    ) -> PaginatedResponse[T]:
        items, total_items = self._page_items(
            data_source,
            offset=self.offset,
            limit=self.limit,
            total=total,
            session=session,
        )
        return self._build_response(
            items=items,
            total=total_items,
            offset=self.offset,
            next_cursor=None,
            previous_cursor=None,
        )

    def paginate_cursor(
        self,
        data_source: Sequence[T] | Iterable[T] | Any,
        *,
        total: int | None = None,
        session: Any | None = None,
    ) -> PaginatedResponse[T]:
        offset = self._cursor_offset if self._cursor_offset is not None else self.offset
        items, total_items = self._page_items(
            data_source,
            offset=offset,
            limit=self.limit,
            total=total,
            session=session,
        )
        next_offset = offset + self.page_size
        previous_offset = max(offset - self.page_size, 0)
        return self._build_response(
            items=items,
            total=total_items,
            offset=offset,
            next_cursor=(
                self.encode_cursor(next_offset) if next_offset < total_items else None
            ),
            previous_cursor=(
                self.encode_cursor(previous_offset) if offset > 0 else None
            ),
        )

    def _build_response(
        self,
        *,
        items: list[T],
        total: int,
        offset: int,
        next_cursor: str | None,
        previous_cursor: str | None,
    ) -> PaginatedResponse[T]:
        total_pages = math.ceil(total / self.page_size) if total else 0
        page = (offset // self.page_size) + 1
        return PaginatedResponse[T](
            items=items,
            total=total,
            page=page,
            page_size=self.page_size,
            total_pages=total_pages,
            has_next=offset + self.page_size < total,
            has_previous=offset > 0,
            next_cursor=next_cursor,
            previous_cursor=previous_cursor,
        )

    def _page_items(
        self,
        data_source: Sequence[T] | Iterable[T] | Any,
        *,
        offset: int,
        limit: int,
        total: int | None,
        session: Any | None,
    ) -> tuple[list[T], int]:
        if session is not None:
            return self._page_sqlalchemy_select(
                data_source, offset=offset, limit=limit, total=total, session=session
            )

        if self._is_sqlalchemy_query(data_source):
            query = cast(Any, data_source)
            total_items = total if total is not None else int(query.count())
            return list(query.offset(offset).limit(limit).all()), total_items

        if isinstance(data_source, Sequence):
            total_items = total if total is not None else len(data_source)
            return list(data_source[offset : offset + limit]), total_items

        items = list(data_source)
        total_items = total if total is not None else len(items)
        return items[offset : offset + limit], total_items

    def _page_sqlalchemy_select(
        self,
        statement: Any,
        *,
        offset: int,
        limit: int,
        total: int | None,
        session: Any,
    ) -> tuple[list[T], int]:
        result = session.execute(statement.offset(offset).limit(limit))
        rows = result.scalars() if hasattr(result, "scalars") else result
        items = list(rows.all() if hasattr(rows, "all") else rows)
        return items, total if total is not None else self._count_sqlalchemy_select(
            statement, session=session
        )

    @staticmethod
    def _count_sqlalchemy_select(statement: Any, *, session: Any) -> int:
        try:
            from sqlalchemy import func, select
        except ImportError:
            return 0

        count_statement = select(func.count()).select_from(
            statement.order_by(None).subquery()
        )
        return int(session.execute(count_statement).scalar_one())

    @staticmethod
    def _is_sqlalchemy_query(data_source: Any) -> bool:
        return all(
            callable(getattr(data_source, method, None))
            for method in ("count", "offset", "limit", "all")
        )


def paginate(
    page: Annotated[
        int,
        Query(
            ge=1,
            description="One-based page number used for offset pagination.",
        ),
    ] = 1,
    page_size: Annotated[
        int,
        Query(
            ge=1,
            le=100,
            description="Number of items to return per page.",
        ),
    ] = 50,
    cursor: Annotated[
        str | None,
        Query(
            description="Encoded cursor returned by a previous cursor-paginated page.",
        ),
    ] = None,
) -> Paginator:
    try:
        return Paginator(page=page, page_size=page_size, cursor=cursor)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
