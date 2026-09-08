"""
FastAPI Pagination Utilities

This module provides standardized pagination support for FastAPI applications.
Supports both offset-based and cursor-based pagination with SQLAlchemy and Pydantic models.
"""

from typing import Any, Callable, Generic, List, Optional, TypeVar, Union
from pydantic import BaseModel, Field
from fastapi import Depends, Query, Request

T = TypeVar('T')


class PageInfo(BaseModel):
    """Standardized page information for paginated responses."""
    page: int = Field(..., description="Current page number (1-indexed)")
    page_size: int = Field(..., description="Number of items per page")
    total: int = Field(..., description="Total number of items")
    total_pages: int = Field(..., description="Total number of pages")


class PaginatedResponse(BaseModel, Generic[T]):
    """Generic paginated response model that wraps any Pydantic model."""
    items: List[T] = Field(..., description="List of items on the current page")
    page_info: PageInfo = Field(..., description="Pagination metadata")


class CursorPageInfo(BaseModel):
    """Cursor-based page information for paginated responses."""
    cursor: Optional[str] = Field(None, description="Current cursor value")
    has_next: bool = Field(..., description="Whether there are more items after this page")
    has_previous: bool = Field(..., description="Whether there are items before this page")
    total: Optional[int] = Field(None, description="Total number of items (if available)")


class CursorPaginatedResponse(BaseModel, Generic[T]):
    """Generic cursor-based paginated response model."""
    items: List[T] = Field(..., description="List of items on the current page")
    page_info: CursorPageInfo = Field(..., description="Cursor pagination metadata")


class Paginator:
    """
    Paginator class for handling pagination logic.
    
    Supports both offset-based and cursor-based pagination with any data source.
    """
    
    def __init__(self, 
                 page: int = 1, 
                 page_size: int = 20,
                 max_page_size: int = 100):
        """
        Initialize the paginator.
        
        Args:
            page: Current page number (1-indexed)
            page_size: Number of items per page
            max_page_size: Maximum allowed page size
        """
        self.page = page
        self.page_size = page_size
        self.max_page_size = max_page_size
        
        # Validate and normalize page
        if self.page < 1:
            self.page = 1
            
        # Validate and normalize page_size
        if self.page_size < 1:
            self.page_size = 1
        if self.page_size > self.max_page_size:
            self.page_size = self.max_page_size
    
    def get_offset_limit(self) -> tuple[int, int]:
        """
        Get skip and limit values for offset-based pagination.
        
        Returns:
            Tuple of (skip, limit) values
        """
        skip = (self.page - 1) * self.page_size
        limit = self.page_size
        return skip, limit
    
    def create_page_info(self, total: int) -> PageInfo:
        """
        Create page info for offset-based pagination.
        
        Args:
            total: Total number of items
            
        Returns:
            PageInfo object with calculated values
        """
        total_pages = max(1, (total + self.page_size - 1) // self.page_size)
        
        return PageInfo(
            page=self.page,
            page_size=self.page_size,
            total=total,
            total_pages=total_pages
        )
    
    def create_paginated_response(self, 
                                   items: List[T], 
                                   total: int) -> PaginatedResponse[T]:
        """
        Create a paginated response for offset-based pagination.
        
        Args:
            items: List of items on the current page
            total: Total number of items
            
        Returns:
            PaginatedResponse with items and page info
        """
        page_info = self.create_page_info(total)
        
        # Calculate has_next and has_previous
        has_next = self.page < page_info.total_pages
        has_previous = self.page > 1
        
        return PaginatedResponse[T](
            items=items,
            page_info=page_info
        )


class CursorPaginator:
    """
    Cursor-based paginator for efficient pagination with large datasets.
    
    Uses encoded cursor values for next/previous page navigation.
    """
    
    def __init__(self, 
                 cursor: Optional[str] = None,
                 page_size: int = 20,
                 max_page_size: int = 100,
                 encode_cursor: Callable[[Any], str] = lambda x: str(x),
                 decode_cursor: Callable[[str], Any] = lambda x: x):
        """
        Initialize the cursor paginator.
        
        Args:
            cursor: Current cursor value (encoded)
            page_size: Number of items per page
            max_page_size: Maximum allowed page size
            encode_cursor: Function to encode cursor values
            decode_cursor: Function to decode cursor values
        """
        self.cursor = cursor
        self.page_size = page_size
        self.max_page_size = max_page_size
        self.encode_cursor = encode_cursor
        self.decode_cursor = decode_cursor
        
        # Validate page_size
        if self.page_size < 1:
            self.page_size = 1
        if self.page_size > self.max_page_size:
            self.page_size = self.max_page_size
    
    def get_cursor_value(self) -> Any:
        """Get the decoded cursor value."""
        if self.cursor is None:
            return None
        return self.decode_cursor(self.cursor)
    
    def create_cursor_page_info(self, 
                                 has_next: bool, 
                                 has_previous: bool,
                                 total: Optional[int] = None) -> CursorPageInfo:
        """
        Create cursor page info.
        
        Args:
            has_next: Whether there are more items after this page
            has_previous: Whether there are items before this page
            total: Optional total number of items
            
        Returns:
            CursorPageInfo object
        """
        return CursorPageInfo(
            cursor=self.cursor,
            has_next=has_next,
            has_previous=has_previous,
            total=total
        )
    
    def create_cursor_paginated_response(self, 
                                          items: List[T],
                                          has_next: bool,
                                          has_previous: bool,
                                          total: Optional[int] = None) -> CursorPaginatedResponse[T]:
        """
        Create a cursor-based paginated response.
        
        Args:
            items: List of items on the current page
            has_next: Whether there are more items after this page
            has_previous: Whether there are items before this page
            total: Optional total number of items
            
        Returns:
            CursorPaginatedResponse with items and page info
        """
        page_info = self.create_cursor_page_info(has_next, has_previous, total)
        return CursorPaginatedResponse[T](
            items=items,
            page_info=page_info
        )


# Dependency injection functions

async def paginate(
    request: Request,
    page: int = Query(1, ge=1, description="Page number (1-indexed)"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page")
) -> Paginator:
    """
    Dependency function for offset-based pagination.
    
    Can be injected into any FastAPI route to get pagination parameters.
    
    Args:
        request: FastAPI Request object
        page: Page number from query parameter
        page_size: Page size from query parameter
        
    Returns:
        Paginator instance with the specified parameters
    """
    return Paginator(page=page, page_size=page_size)


async def cursor_paginate(
    request: Request,
    cursor: Optional[str] = Query(None, description="Cursor for pagination"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page")
) -> CursorPaginator:
    """
    Dependency function for cursor-based pagination.
    
    Can be injected into any FastAPI route to get cursor pagination parameters.
    
    Args:
        request: FastAPI Request object
        cursor: Cursor value from query parameter
        page_size: Page size from query parameter
        
    Returns:
        CursorPaginator instance with the specified parameters
    """
    return CursorPaginator(cursor=cursor, page_size=page_size)


# Utility functions

def encode_offset_cursor(offset: int) -> str:
    """Encode an offset value as a cursor string."""
    import base64
    return base64.b64encode(str(offset).encode()).decode()


def decode_offset_cursor(cursor: str) -> int:
    """Decode a cursor string back to an offset value."""
    import base64
    try:
        return int(base64.b64decode(cursor.encode()).decode())
    except (ValueError, TypeError):
        return 0
