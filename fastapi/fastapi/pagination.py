from typing import TypeVar, Generic, Optional, Type
from fastapi import Query
from pydantic import BaseModel
from pydantic.generics import GenericModel
from pydantic.fields import Field
import math


T = TypeVar('T')


class PaginatedResponse(GenericModel, Generic[T]):
    items: list[T] = Field(...)
    total: int = Field(...)
    page: int = Field(...)
    page_size: int = Field(...)
    total_pages: int = Field(...)
    has_next: bool = Field(...)
    has_previous: bool = Field(...)


class OffsetPagination:
    def __init__(self, page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=100)):
        self.page = page
        self.page_size = page_size
        self.offset = (page - 1) * page_size

    def get_paginated_response(self, items: list[T], total: int) -> PaginatedResponse[T]:
        total_pages = math.ceil(total / self.page_size) if total > 0 else 0
        return PaginatedResponse(
            items=items,
            total=total,
            page=self.page,
            page_size=self.page_size,
            total_pages=total_pages,
            has_next=self.page < total_pages,
            has_previous=self.page > 1
        )


class CursorPagination:
    def __init__(self, cursor: str = Query(None), limit: int = Query(50, ge=1, le=100)):
        self.cursor = cursor
        self.limit = limit

    def get_paginated_response(self, items: list[T], total: int, next_cursor: str = None, previous_cursor: str = None) -> dict:
        return {
            "items": items,
            "total": total,
            "next_cursor": next_cursor,
            "previous_cursor": previous_cursor
        }


def get_offset_skip_limit(page: int, page_size: int):
    return (page - 1) * page (1) * page_size


def paginate(page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=100)):
    return OffsetPagination(page, page_size)


T = TypeVar('T', bound=BaseModel)


class PaginatedResponse(GenericModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
    total_pages: int
    has_next: bool
    has_previous: bool


    class Config:
        orm_mode = True


def paginate(page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=100)):
    return OffsetPagination(page, page_size)


class OffsetPagination:
    def __init__(self, page: int, page_size: int):
        self.page = page
        self.page_size = page_size
        self.offset = (page - 1) * page_size

    def get_paginated_response(self, items: list, total: int):
        total_pages = (total + self.page_size - 1) // self.page
        return {
            "items": items,
            "total": total,
            "page": self.page,
            "page_size": self.page_size,
            "total_pages": total_pages,
            "has_next": self.page < total_pages,
            "has_previous": self.page > 1
        }


def paginate_cursor(cursor: str = Query(None), limit: int = Query(50, ge=1, le=100)):
    return CursorPagination(cursor, limit)


class CursorPagination:
    def __init__(self, cursor, limit):
        self.cursor = cursor
        self.limit = limit

    def get_paginated_response(self, items: list, total: int, next_cursor: str = None, previous_cursor: str = None):
        return {
            "items": items,
            "total": total,
            "next_cursor": next_cursor,
            "previous_cursor": previous_cursor
        }