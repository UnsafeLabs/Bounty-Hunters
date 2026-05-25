from typing import TypeVar, Generic, Optional, List, Type, Any
from pydantic import BaseModel
from pydantic.generics import GenericModel
from fastapi import Query, Depends
from sqlalchemy.orm import Session
import base64
import json
import math


T = TypeVar('T')


class PaginatedResponse(GenericModel, Generic[T]):
    items: List[T]
    total: Optional[int] = None
    page: Optional[int] = None
    page_size: Optional[int] = None
    total_pages: Optional[int] = None
    has_next: Optional[bool] = None
    has_previous: Optional[bool] = None


class PaginationParams(BaseModel):
    page: int = Query(default=1, ge=1)
    page_size: int = Query(default=50, ge=1, le=100)


class CursorPaginationParams(BaseModel):
    cursor: Optional[str] = None
    page_size: int = Query(default=50, ge=1, le=100)


class OffsetPaginator:
    def __init__(self, page: int, page_size: int, total: int):
        self.page = page
        self.page_size = page_size
        self.total = total
        self.page_size = max(1, page_size)  # Ensure page_size is at least 1
        self.page = max(1, page)  # Ensure page is at least 1

    def get_paginated_response(self, items: List[T]) -> PaginatedResponse:
        has_previous = self.page > 1
        total_pages = math.ceil(self.total / self.page_size) if self.total else 0
        has_next = self.page < total_pages
        
        return PaginatedResponse(
            items=items,
            total=self.total,
            page=self.page,
            page_size=self.page_size,
            total_pages=total_pages,
            has_next=has_next,
            has_previous=has_previous
        )


class CursorPaginator:
    def __init__(self, cursor: str = None, page_size: int = 50):
        self.cursor = cursor
        self.page_size = page_size
        if cursor:
            try:
                self.cursor_data = json.loads(base64.urlsafe_b64decode(cursor).decode())
            except Exception:
                self.cursor_data = {}
        else:
            self.cursor_data = {}

    def get_cursor_response(self, items: List[T], next_cursor: str = None) -> PaginatedResponse:
        has_next = next_cursor is not None
        has_previous = bool(self.cursor)  # If cursor exists, we have previous page
        
        return PaginatedResponse(
            items=items,
            total=None,
            page=None,
            page_size=self.page_size,
            total_pages=None,
            has_next=has_next,
            has_previous=has_previous
        )


def get_pagination_params(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100)
) -> OffsetPaginator:
    return OffsetPaginator(page=page, page_size=page_size, total=0)


def paginate(db: Session = Depends(), pagination: OffsetPaginator = Depends(get_pagination_params)):
    return pagination


def apply_offset_pagination(query, page: int, page_size: int):
    # Calculate offset for offset-based pagination
    offset = (page - 1) * page_size
    limit = page_size
    return query.offset(offset).limit(limit)


def create_pagination_response(items, total, page, page_size, has_next=False, has_previous=False):
    return PaginatedResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=math.ceil(total / page_size) if total else 0,
        has_next=has_next,
        has_previous=has_previous
    )


def create_cursor_response(items, cursor=None):
    return PaginatedResponse(
        items=items,
        total=None,
        page=None,
        page_size=None,
        total_pages=None,
        has_next=cursor is not None,
        has_previous=cursor is not None
    )


class Pagination:
    def __init__(self):
        self.default_page = 1
        self.default_page_size = 50
    
    def paginate(self, query, page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=100)):
        offset = (page - 1) * page_size
        return query.offset(offset).limit(page_size)
    
    
def get_cursor_or_400(cursor: str = None):
    if cursor:
        try:
            return json.loads(base64.urlsafe_b64decode(cursor))
        except Exception:
            from fastapi import HTTPException
            raise HTTPException(status_code=400, detail="Invalid cursor")
    return {}


def paginate_with_cursor(db: Session = Depends(), cursor: str = Query(None), page_size: int = Query(50)):
    paginator = CursorPaginator(cursor, page_size)
    return paginator