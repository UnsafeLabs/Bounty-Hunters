"""FastAPI Pagination Utility - Offset and Cursor-based pagination support."""
from typing import Generic, List, Optional, TypeVar, Any, Callable
from dataclasses import dataclass
import base64
import json
from urllib.parse import urlencode, parse_qs, urlparse, urlunparse

from fastapi import Query, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Query as SQLQuery
from sqlalchemy import func

T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    """Generic paginated response wrapper for any Pydantic model."""
    items: List[T] = Field(..., description="List of items for the current page")
    total: int = Field(..., description="Total number of items across all pages")
    page: int = Field(..., description="Current page number (1-indexed)")
    page_size: int = Field(..., description="Number of items per page")
    total_pages: int = Field(..., description="Total number of pages")
    has_next: bool = Field(..., description="Whether there is a next page")
    has_previous: bool = Field(..., description="Whether there is a previous page")
    next_cursor: Optional[str] = Field(None, description="Cursor for the next page (cursor-based)")
    previous_cursor: Optional[str] = Field(None, description="Cursor for the previous page (cursor-based)")


@dataclass
class PaginationParams:
    """Pagination parameters extracted from query string."""
    page: int = 1
    page_size: int = 20
    cursor: Optional[str] = None
    
    def __post_init__(self):
        # Validate and normalize
        self.page = max(1, self.page) if self.page is not None else 1
        self.page_size = max(1, min(100, self.page_size)) if self.page_size is not None else 20


def paginate(
    page: int = Query(1, ge=1, description="Page number (1-indexed)"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    cursor: Optional[str] = Query(None, description="Cursor for cursor-based pagination")
) -> PaginationParams:
    """Dependency function to extract pagination parameters from query string.
    
    Usage:
        @app.get("/items")
        async def get_items(params: PaginationParams = Depends(paginate)):
            ...
    """
    return PaginationParams(page=page, page_size=page_size, cursor=cursor)


class Paginator:
    """Pagination utility for SQLAlchemy queries and Pydantic models."""
    
    def __init__(self, page: int = 1, page_size: int = 20, cursor: Optional[str] = None):
        self.page = max(1, page)
        self.page_size = max(1, min(100, page_size))
        self.cursor = cursor
    
    @staticmethod
    def _encode_cursor(data: dict) -> str:
        """Encode cursor data to base64 string."""
        json_str = json.dumps(data, separators=(',', ':'))
        return base64.urlsafe_b64encode(json_str.encode()).decode().rstrip('=')
    
    @staticmethod
    def _decode_cursor(cursor: str) -> dict:
        """Decode cursor from base64 string."""
        # Add padding if needed
        padding = 4 - len(cursor) % 4
        if padding != 4:
            cursor += '=' * padding
        json_str = base64.urlsafe_b64decode(cursor.encode()).decode()
        return json.loads(json_str)
    
    def paginate_offset(self, query: SQLQuery, item_schema: type) -> PaginatedResponse:
        """Apply offset-based pagination to a SQLAlchemy query.
        
        Args:
            query: SQLAlchemy query object
            item_schema: Pydantic model class for items
            
        Returns:
            PaginatedResponse with items and metadata
        """
        # Get total count
        total = query.session.scalar(
            query.statement.with_only_columns(func.count()).order_by(None)
        )
        
        # Calculate pagination
        total_pages = (total + self.page_size - 1) // self.page_size if total > 0 else 1
        skip = (self.page - 1) * self.page_size
        
        # Get items for current page
        items = query.offset(skip).limit(self.page_size).all()
        
        # Convert to schema
        item_list = [item_schema.model_validate(item) for item in items]
        
        return PaginatedResponse[
            item_schema
        ](
            items=item_list,
            total=total,
            page=self.page,
            page_size=self.page_size,
            total_pages=total_pages,
            has_next=self.page < total_pages,
            has_previous=self.page > 1
        )
    
    def paginate_cursor(
        self, 
        query: SQLQuery, 
        item_schema: type,
        cursor_field: str = "id",
        sort_order: str = "asc"
    ) -> PaginatedResponse:
        """Apply cursor-based pagination to a SQLAlchemy query.
        
        Args:
            query: SQLAlchemy query object
            item_schema: Pydantic model class for items
            cursor_field: Field name to use for cursor (default: "id")
            sort_order: "asc" or "desc"
            
        Returns:
            PaginatedResponse with items and cursor metadata
        """
        # Apply cursor filter if provided
        if self.cursor:
            try:
                cursor_data = self._decode_cursor(self.cursor)
                cursor_value = cursor_data.get("value")
                is_next = cursor_data.get("direction") == "next"
                
                if cursor_value is not None:
                    field = getattr(query.column_descriptions[0]['entity'], cursor_field)
                    if (sort_order == "asc" and is_next) or (sort_order == "desc" and not is_next):
                        query = query.filter(field > cursor_value)
                    else:
                        query = query.filter(field < cursor_value)
            except (ValueError, KeyError):
                # Invalid cursor, ignore it
                pass
        
        # Get one extra item to check if there's a next page
        items = query.limit(self.page_size + 1).all()
        
        has_next = len(items) > self.page_size
        items = items[:self.page_size]  # Remove the extra item
        
        # Convert to schema
        item_list = [item_schema.model_validate(item) for item in items]
        
        # Generate cursors
        next_cursor = None
        previous_cursor = None
        
        if has_next and items:
            last_item = items[-1]
            last_value = getattr(last_item, cursor_field, None)
            if last_value is not None:
                next_cursor = self._encode_cursor({"value": last_value, "direction": "next"})
        
        if items and self.cursor:
            first_item = items[0]
            first_value = getattr(first_item, cursor_field, None)
            if first_value is not None:
                previous_cursor = self._encode_cursor({"value": first_value, "direction": "prev"})
        
        # For cursor-based, we don't know total count efficiently
        # Return -1 to indicate unknown
        return PaginatedResponse[
            item_schema
        ](
            items=item_list,
            total=-1,  # Unknown for cursor-based
            page=self.page,
            page_size=self.page_size,
            total_pages=-1,  # Unknown
            has_next=has_next,
            has_previous=self.cursor is not None,
            next_cursor=next_cursor,
            previous_cursor=previous_cursor
        )


def create_paginated_response(
    items: List[Any],
    total: int,
    page: int,
    page_size: int
) -> PaginatedResponse:
    """Helper to create a PaginatedResponse from a list of items.
    
    Useful for in-memory pagination or when total is already known.
    """
    total_pages = (total + page_size - 1) // page_size if total