"""
Pagination utilities for FastAPI applications.

Provides both offset-based and cursor-based pagination with dependency injection
and generic response models.
"""

from typing import Any, Generic, TypeVar, Optional, List, Dict, Callable, Union
from pydantic import BaseModel, Field
from pydantic.generics import GenericModel
from fastapi import Depends, Request, HTTPException, Query

T = TypeVar('T')


class PageInfo(BaseModel):
    """Pagination metadata included in all paginated responses."""
    has_next_page: bool = Field(..., description="Whether there are more items after this page")
    has_previous_page: bool = Field(..., description="Whether there are more items before this page")
    start_cursor: Optional[str] = Field(None, description="Cursor for the start of this page")
    end_cursor: Optional[str] = Field(None, description="Cursor for the end of this page")
    total_count: Optional[int] = Field(None, description="Total number of items across all pages")


class OffsetPageInfo(PageInfo):
    """Pagination metadata for offset-based pagination."""
    current_page: int = Field(..., description="Current page number (1-indexed)")
    total_pages: Optional[int] = Field(None, description="Total number of pages")
    items_per_page: int = Field(..., description="Number of items per page")


class PaginatedResponse(GenericModel, Generic[T]):
    """Generic response model for offset-based pagination."""
    items: List[T] = Field(..., description="List of items on this page")
    page_info: OffsetPageInfo = Field(..., description="Pagination metadata")


class CursorPageInfo(PageInfo):
    """Pagination metadata for cursor-based pagination."""
    pass


class CursorPaginatedResponse(GenericModel, Generic[T]):
    """Generic response model for cursor-based pagination."""
    edges: List[Dict[str, Any]] = Field(..., description="List of edges with nodes and cursors")
    page_info: CursorPageInfo = Field(..., description="Pagination metadata")


class PaginationConfig(BaseModel):
    """Configuration for pagination behavior."""
    max_items_per_page: int = Field(100, description="Maximum number of items per page")
    default_items_per_page: int = Field(20, description="Default number of items per page")
    max_pages: Optional[int] = Field(None, description="Maximum number of pages to return")


class Paginator(Generic[T]):
    """
    Offset-based paginator.
    
    Supports pagination with page and items_per_page parameters.
    """
    
    def __init__(
        self,
        items: List[T],
        total_count: Optional[int] = None,
        items_per_page: int = 20,
        current_page: int = 1,
        max_items_per_page: int = 100
    ):
        self.items = items
        self.total_count = total_count
        self.items_per_page = min(items_per_page, max_items_per_page)
        self.current_page = current_page
        self.max_items_per_page = max_items_per_page
    
    @classmethod
    def from_query(
        cls,
        items: List[T],
        total_count: Optional[int] = None,
        *,
        page: int = Query(1, ge=1, description="Page number (1-indexed)"),
        items_per_page: int = Query(20, ge=1, le=100, description="Items per page"),
        max_items_per_page: int = 100
    ) -> 'Paginator[T]':
        """Create a paginator from query parameters."""
        return cls(
            items=items,
            total_count=total_count,
            items_per_page=items_per_page,
            current_page=page,
            max_items_per_page=max_items_per_page
        )
    
    def get_page(self) -> List[T]:
        """Get the items for the current page."""
        start = (self.current_page - 1) * self.items_per_page
        end = start + self.items_per_page
        return self.items[start:end]
    
    def get_page_info(self) -> OffsetPageInfo:
        """Get pagination metadata for the current page."""
        total_count = self.total_count if self.total_count is not None else len(self.items)
        total_pages = (total_count + self.items_per_page - 1) // self.items_per_page if total_count > 0 else 0
        
        start_idx = (self.current_page - 1) * self.items_per_page
        end_idx = min(start_idx + self.items_per_page, total_count)
        
        return OffsetPageInfo(
            has_next_page=self.current_page < total_pages,
            has_previous_page=self.current_page > 1,
            current_page=self.current_page,
            total_pages=total_pages,
            items_per_page=self.items_per_page,
            total_count=total_count
        )
    
    def get_response(self) -> PaginatedResponse[T]:
        """Get a paginated response with items and metadata."""
        return PaginatedResponse[T](
            items=self.get_page(),
            page_info=self.get_page_info()
        )


class CursorPaginator(Generic[T]):
    """
    Cursor-based paginator.
    
    Supports pagination with after and before cursors, as well as first and last limits.
    Uses opaque cursors for better security and to hide implementation details.
    """
    
    def __init__(
        self,
        items: List[T],
        total_count: Optional[int] = None,
        cursor_field: str = 'id',
        max_items_per_page: int = 100
    ):
        self.items = items
        self.total_count = total_count
        self.cursor_field = cursor_field
        self.max_items_per_page = max_items_per_page
    
    def _get_cursor(self, item: T, index: int) -> str:
        """Generate a cursor for an item."""
        # Use a simple base64-encoded cursor with index and value
        import base64
        import json
        cursor_data = {
            'index': index,
            'value': getattr(item, self.cursor_field, str(index))
        }
        return base64.b64encode(json.dumps(cursor_data).encode()).decode()
    
    def _decode_cursor(self, cursor: Optional[str]) -> Optional[Dict[str, Any]]:
        """Decode a cursor to get its data."""
        if not cursor:
            return None
        try:
            import base64
            import json
            decoded = base64.b64decode(cursor.encode()).decode()
            return json.loads(decoded)
        except:
            return None
    
    def get_page(
        self,
        first: Optional[int] = None,
        last: Optional[int] = None,
        after: Optional[str] = None,
        before: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Get a page of items using cursor-based pagination.
        
        Args:
            first: Maximum number of items to return from the start
            last: Maximum number of items to return from the end
            after: Cursor to start after (exclusive)
            before: Cursor to end before (exclusive)
        """
        # Default limits
        first = first if first is not None else self.max_items_per_page
        first = min(first, self.max_items_per_page)
        
        if last is not None:
            last = min(last, self.max_items_per_page)
        
        # Decode cursors
        after_data = self._decode_cursor(after)
        before_data = self._decode_cursor(before)
        
        # Get indices
        after_idx = after_data['index'] + 1 if after_data else 0
        before_idx = before_data['index'] if before_data else len(self.items)
        
        # Handle forward pagination (first, after)
        if first is not None and after is not None:
            items = self.items[after_idx:after_idx + first]
            has_next = after_idx + first < len(self.items)
            has_prev = after_idx > 0
            
            edges = []
            for i, item in enumerate(items):
                cursor = self._get_cursor(item, after_idx + i)
                edges.append({
                    'node': item,
                    'cursor': cursor
                })
            
            start_cursor = edges[0]['cursor'] if edges else None
            end_cursor = edges[-1]['cursor'] if edges else None
            
            return {
                'edges': edges,
                'page_info': CursorPageInfo(
                    has_next_page=has_next,
                    has_previous_page=has_prev,
                    start_cursor=start_cursor,
                    end_cursor=end_cursor,
                    total_count=self.total_count
                )
            }
        
        # Handle backward pagination (last, before)
        if last is not None and before is not None:
            items = self.items[max(0, before_idx - last):before_idx]
            has_next = before_idx < len(self.items)
            has_prev = before_idx - last > 0
            
            edges = []
            for i, item in enumerate(items):
                cursor = self._get_cursor(item, before_idx - last + i)
                edges.append({
                    'node': item,
                    'cursor': cursor
                })
            
            start_cursor = edges[0]['cursor'] if edges else None
            end_cursor = edges[-1]['cursor'] if edges else None
            
            return {
                'edges': edges,
                'page_info': CursorPageInfo(
                    has_next_page=has_next,
                    has_previous_page=has_prev,
                    start_cursor=start_cursor,
                    end_cursor=end_cursor,
                    total_count=self.total_count
                )
            }
        
        # Default to first page
        items = self.items[:first]
        edges = []
        for i, item in enumerate(items):
            cursor = self._get_cursor(item, i)
            edges.append({
                'node': item,
                'cursor': cursor
            })
        
        start_cursor = edges[0]['cursor'] if edges else None
        end_cursor = edges[-1]['cursor'] if edges else None
        
        return {
            'edges': edges,
            'page_info': CursorPageInfo(
                has_next_page=first < len(self.items),
                has_previous_page=False,
                start_cursor=start_cursor,
                end_cursor=end_cursor,
                total_count=self.total_count
            )
        }
    
    def get_response(self, **kwargs: Any) -> CursorPaginatedResponse[T]:
        """Get a cursor-paginated response."""
        page_data = self.get_page(**kwargs)
        return CursorPaginatedResponse[T](
            edges=page_data['edges'],
            page_info=page_data['page_info']
        )


# Dependency injection for pagination

class PaginationParams(BaseModel):
    """Standard pagination query parameters."""
    page: int = Field(1, ge=1, description="Page number (1-indexed)")
    items_per_page: int = Field(20, ge=1, le=100, description="Items per page")


class CursorPaginationParams(BaseModel):
    """Cursor-based pagination query parameters."""
    first: Optional[int] = Field(None, ge=1, le=100, description="Number of items to return from start")
    last: Optional[int] = Field(None, ge=1, le=100, description="Number of items to return from end")
    after: Optional[str] = Field(None, description="Cursor to start after")
    before: Optional[str] = Field(None, description="Cursor to end before")


def get_pagination_params(
    page: int = Query(1, ge=1, description="Page number"),
    items_per_page: int = Query(20, ge=1, le=100, description="Items per page")
) -> PaginationParams:
    """Dependency to extract offset pagination parameters from request."""
    return PaginationParams(page=page, items_per_page=items_per_page)


def get_cursor_pagination_params(
    first: Optional[int] = Query(None, ge=1, le=100, description="First N items"),
    last: Optional[int] = Query(None, ge=1, le=100, description="Last N items"),
    after: Optional[str] = Query(None, description="After cursor"),
    before: Optional[str] = Query(None, description="Before cursor")
) -> CursorPaginationParams:
    """Dependency to extract cursor pagination parameters from request."""
    return CursorPaginationParams(first=first, last=last, after=after, before=before)


def paginate_offset(
    items: List[T],
    total_count: Optional[int] = None,
    params: PaginationParams = Depends(get_pagination_params)
) -> PaginatedResponse[T]:
    """
    Helper function to paginate a list of items using offset pagination.
    
    Usage:
        @app.get("/items")
        async def get_items(
            items: List[Item] = Depends(get_all_items),
            response: PaginatedResponse[Item] = Depends(
                lambda: paginate_offset(items, total_count=len(items))
            )
        ):
            return response
    """
    paginator = Paginator[T](
        items=items,
        total_count=total_count,
        items_per_page=params.items_per_page,
        current_page=params.page
    )
    return paginator.get_response()


def paginate_cursor(
    items: List[T],
    total_count: Optional[int] = None,
    cursor_field: str = 'id',
    params: CursorPaginationParams = Depends(get_cursor_pagination_params)
) -> CursorPaginatedResponse[T]:
    """
    Helper function to paginate a list of items using cursor pagination.
    
    Usage:
        @app.get("/items")
        async def get_items(
            items: List[Item] = Depends(get_all_items),
            response: CursorPaginatedResponse[Item] = Depends(
                lambda: paginate_cursor(items, cursor_field='uuid')
            )
        ):
            return response
    """
    paginator = CursorPaginator[T](
        items=items,
        total_count=total_count,
        cursor_field=cursor_field
    )
    return paginator.get_response(
        first=params.first,
        last=params.last,
        after=params.after,
        before=params.before
    )
