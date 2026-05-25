from typing import TypeVar, Generic, Optional, List, Dict, Any, Union
from pydantic import BaseModel, Field
from pydantic.generics import GenericModel
from fastapi import Query
from base64 import urlsafe_b64encode, urlsafe_b64decode
import json


# Type variables for generics
T = TypeVar("T")


class PaginatedResponse(GenericModel, Generic[T]):
    items: List[T]
    total: int
    page: int
    page_size: int
    total_pages: int
    has_next: bool
    has_previous: bool
    next_cursor: Optional[str] = None
    previous_cursor: Optional[str] = None


class OffsetPaginationResult(BaseModel):
    items: List[Any] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 10
    total_pages: int = 0
    has_next: bool = False
    has_previous: bool = False


class Cursor:
    def __init__(self, cursor_value: str = None):
        self.cursor_value = cursor_value
    
    def encode(self, data: Dict[str, Any]) -> str:
        """Encode cursor data to base64 string"""
        if not data:
            return None
        json_str = json.dumps(data)
        return urlsafe_b64encode(json_str.encode()).decode()
    
    def decode(self, cursor: str) -> Dict[str, Any]:
        """Decode base64 cursor string to dict"""
        if not cursor:
            return {}
        try:
            json_str = urlsafe_b64decode(cursor).decode()
            return json.loads(json_str)
        except:
            return {}


def paginate(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(10, ge=1, le=100, description="Page size (max 100)")
) -> OffsetPaginationResult:
    """
    FastAPI dependency for pagination.
    
    This dependency provides both offset and cursor-based pagination
    depending on whether a cursor parameter is provided.
    """
    # For offset-based pagination
    if page and page_size:
        return OffsetPaginationResult(
            items=[],
            total=0,
            page=page,
            page_size=page_size,
            total_pages=0,
            has_next=False,
            has_previous=False
        )
    
    # For cursor-based pagination
    # This would be implemented in a real scenario with proper cursor handling
    return OffsetPaginationResult(
        items=[],
        total=0,
        page=1,
        page_size=10,
        total_pages=0,
        has_next=False,
        has_previous=False
    )


def get_pagination_info(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(10, ge=1, le=100, description="Page size (max 100)"))
    -> OffsetPaginationResult:
    """
    Get pagination information for offset-based pagination.
    """
    return OffsetPaginationResult(
        items=[],
        total=0,
        page=page,
        page_size=page_size,
        total_pages=0,
        has_next=False,
        has_previous=False
    )


def get_cursor_pagination_info(
    cursor: str = Query(None, description="Cursor for pagination"))
    -> OffsetPaginationResult:
    """
    Get pagination information for cursor-based pagination.
    """
    # Decode cursor if provided
    cursor_data = {}
    if cursor:
        try:
            cursor_data = Cursor().decode(cursor)
        except:
            pass
    
    return OffsetPaginationResult(
        items=[],
        total=0,
        page=1,
        page_size=10,
        total_pages=0,
        has_next=False,
        has_previous=False
    )


def get_pagination(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(10, ge=1, le=100, description="Page size (max 100)"))
    -> OffsetPaginationResult:
    """
    Get pagination information for both offset and cursor-based pagination.
    """
    # Handle offset-based pagination
    if page and page_size:
        return get_pagination_info(page=page, page_size=page_size)
    
    # Handle cursor-based pagination
    return get_cursor_pagination_info()