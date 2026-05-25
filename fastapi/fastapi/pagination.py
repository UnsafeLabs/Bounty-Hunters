from typing import TypeVar, Generic, Optional, List, Dict, Any, Union
from pydantic import BaseModel
from pydantic.generics import GenericModel
from pydantic.tools import parse_obj_as
from fastapi import Query, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
import base64
import json


class OffsetPagination:
    def __init__(
        self,
        page: int = Query(1, ge=1, description="Page number (1-indexed)"),
        page_size: int = Query(50, le=100, description="Number of items per page"),
    ):
        self.page = page
        self.page_size = page_size
        self.skip = (page - 1) * page_size
        self.limit = page_size


T = TypeVar("T")


class PaginatedResponse(GenericModel, Generic[T]):
    items: List[T]
    total: int
    page: int
    page_size: int
    total_pages: int
    has_next: bool
    has_previous: bool


class CursorPagination:
    def __init__(self):
        pass


def paginate(
    page: int = Query(1, ge=1, description="Page number (1-indexed)"),
    page_size: int = Query(50, le=100, description="Number of items per page"),
):
    return OffsetPagination(page, page_size)


class OffsetPaginatedQuery:
    def __init__(self, query, session: Session):
        self.query = query
        self.session = session

    def __call__(self):
        return self

    def paginate(self, page, page_size):
        # Calculate total count
        total = self.query.count()
        # Apply offset and limit
        offset = (page - 1) * page_size
        items = self.query.offset(offset).limit(page_size).all()
        return items, total


def get_paginated_response(
    items: List[T], total: int, page: int, page_size: int
) -> PaginatedResponse[T]:
    total_pages = (total + page_size - 1) // page_size
    has_next = page < total_pages
    has_previous = page > 1
    return PaginatedResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        has_next=has_next,
        has_previous=has_previous,
    )


def encode_cursor(cursor: str) -> str:
    # For cursor-based pagination, we would implement cursor encoding here
    # This is a simplified version for demonstration
    cursor_data = json.dumps(cursor)
    return base64.urlsafe_b64encode(cursor_data.encode()).decode()


def decode_cursor(cursor: str) -> str:
    # For cursor-based pagination, we would implement cursor decoding here
    # This is a simplified version for demonstration
    cursor_data = base64.urlsafe_b64decode(cursor).decode()
    return json.loads(cursor_data)