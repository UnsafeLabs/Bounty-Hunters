import base64
import json
from collections.abc import Sequence
from typing import Generic, Optional, TypeVar

from fastapi import Query
from pydantic import BaseModel

T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    items: Sequence[T]
    total: int
    page: int
    page_size: int
    total_pages: int
    has_next: bool
    has_previous: bool
    next_cursor: Optional[str] = None
    previous_cursor: Optional[str] = None


class Paginator:
    def __init__(self, page: int = 1, page_size: int = 20):
        self.page = page if page >= 1 else 1
        self.page_size = page_size if page_size >= 1 else 20

    def skip(self) -> int:
        return (self.page - 1) * self.page_size

    def limit(self) -> int:
        return self.page_size

    def paginate(self, items: Sequence[T], total: int) -> PaginatedResponse[T]:
        total_pages = max(1, (total + self.page_size - 1) // self.page_size) if total > 0 else 0
        return PaginatedResponse(
            items=items,
            total=total,
            page=self.page,
            page_size=self.page_size,
            total_pages=total_pages,
            has_next=self.page < total_pages,
            has_previous=self.page > 1,
            next_cursor=self._encode_cursor(self.page + 1) if self.page < total_pages else None,
            previous_cursor=self._encode_cursor(self.page - 1) if self.page > 1 else None,
        )

    @staticmethod
    def _encode_cursor(page: int) -> str:
        return base64.urlsafe_b64encode(json.dumps({"p": page}).encode()).decode()

    @staticmethod
    def decode_cursor(cursor: str) -> int:
        return json.loads(base64.urlsafe_b64decode(cursor).decode())["p"]

    @classmethod
    def from_cursor(cls, cursor: str, page_size: int = 20) -> "Paginator":
        page = cls.decode_cursor(cursor)
        return cls(page=page, page_size=page_size)


def paginate(page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100)) -> Paginator:
    return Paginator(page=page, page_size=page_size)
