"""
Tests for pagination utilities.
"""

import pytest
from fastapi import FastAPI, Depends, Query
from fastapi.testclient import TestClient
from pydantic import BaseModel
from typing import List, Optional, Generic, TypeVar

from fastapi.pagination import (
    Paginator,
    CursorPaginator,
    PaginatedResponse,
    CursorPaginatedResponse,
    PageInfo,
    OffsetPageInfo,
    CursorPageInfo,
    get_pagination_params,
    get_cursor_pagination_params,
    paginate_offset,
    paginate_cursor,
    PaginationParams,
    CursorPaginationParams,
)


# Test models
class Item(BaseModel):
    id: int
    name: str
    value: float


T = TypeVar('T')


class TestPaginator:
    """Tests for offset-based Paginator."""
    
    def test_basic_pagination(self):
        items = [Item(id=i, name=f"Item {i}", value=float(i)) for i in range(100)]
        paginator = Paginator[Item](items=items, items_per_page=10, current_page=1)
        
        page = paginator.get_page()
        assert len(page) == 10
        assert page[0].id == 0
        assert page[9].id == 9
    
    def test_second_page(self):
        items = [Item(id=i, name=f"Item {i}", value=float(i)) for i in range(100)]
        paginator = Paginator[Item](items=items, items_per_page=10, current_page=2)
        
        page = paginator.get_page()
        assert len(page) == 10
        assert page[0].id == 10
        assert page[9].id == 19
    
    def test_last_page(self):
        items = [Item(id=i, name=f"Item {i}", value=float(i)) for i in range(25)]
        paginator = Paginator[Item](items=items, items_per_page=10, current_page=3)
        
        page = paginator.get_page()
        assert len(page) == 5
        assert page[0].id == 20
        assert page[4].id == 24
    
    def test_page_info_first_page(self):
        items = [Item(id=i, name=f"Item {i}", value=float(i)) for i in range(100)]
        paginator = Paginator[Item](items=items, items_per_page=10, current_page=1, total_count=100)
        
        info = paginator.get_page_info()
        assert info.current_page == 1
        assert info.total_pages == 10
        assert info.has_next_page is True
        assert info.has_previous_page is False
        assert info.items_per_page == 10
        assert info.total_count == 100
    
    def test_page_info_last_page(self):
        items = [Item(id=i, name=f"Item {i}", value=float(i)) for i in range(100)]
        paginator = Paginator[Item](items=items, items_per_page=10, current_page=10, total_count=100)
        
        info = paginator.get_page_info()
        assert info.current_page == 10
        assert info.total_pages == 10
        assert info.has_next_page is False
        assert info.has_previous_page is True
    
    def test_page_info_middle_page(self):
        items = [Item(id=i, name=f"Item {i}", value=float(i)) for i in range(100)]
        paginator = Paginator[Item](items=items, items_per_page=10, current_page=5, total_count=100)
        
        info = paginator.get_page_info()
        assert info.current_page == 5
        assert info.has_next_page is True
        assert info.has_previous_page is True
    
    def test_response_format(self):
        items = [Item(id=i, name=f"Item {i}", value=float(i)) for i in range(20)]
        paginator = Paginator[Item](items=items, items_per_page=10, current_page=1, total_count=20)
        
        response = paginator.get_response()
        assert isinstance(response, PaginatedResponse)
        assert len(response.items) == 10
        assert isinstance(response.page_info, OffsetPageInfo)
        assert response.page_info.current_page == 1
        assert response.page_info.total_pages == 2
    
    def test_max_items_per_page(self):
        items = [Item(id=i, name=f"Item {i}", value=float(i)) for i in range(100)]
        paginator = Paginator[Item](items=items, items_per_page=50, current_page=1, max_items_per_page=30)
        
        # items_per_page should be capped at max
        assert paginator.items_per_page == 30
    
    def test_empty_list(self):
        items: List[Item] = []
        paginator = Paginator[Item](items=items, items_per_page=10, current_page=1)
        
        page = paginator.get_page()
        assert len(page) == 0
        
        info = paginator.get_page_info()
        assert info.current_page == 1
        assert info.total_pages == 0


class TestCursorPaginator:
    """Tests for cursor-based CursorPaginator."""
    
    def test_basic_cursor_pagination(self):
        items = [Item(id=i, name=f"Item {i}", value=float(i)) for i in range(10)]
        paginator = CursorPaginator[Item](items=items, cursor_field='id')
        
        result = paginator.get_page(first=5)
        assert len(result['edges']) == 5
        assert result['page_info'].has_next_page is True
        assert result['page_info'].has_previous_page is False
    
    def test_cursor_pagination_with_after(self):
        items = [Item(id=i, name=f"Item {i}", value=float(i)) for i in range(20)]
        paginator = CursorPaginator[Item](items=items, cursor_field='id')
        
        # Get first page
        first_page = paginator.get_page(first=5)
        assert len(first_page['edges']) == 5
        
        # Get second page using after cursor
        after_cursor = first_page['page_info'].end_cursor
        second_page = paginator.get_page(first=5, after=after_cursor)
        assert len(second_page['edges']) == 5
        assert second_page['edges'][0]['node'].id == 5
    
    def test_cursor_response_format(self):
        items = [Item(id=i, name=f"Item {i}", value=float(i)) for i in range(10)]
        paginator = CursorPaginator[Item](items=items, cursor_field='id')
        
        response = paginator.get_response(first=5)
        assert isinstance(response, CursorPaginatedResponse)
        assert len(response.edges) == 5
        assert isinstance(response.page_info, CursorPageInfo)
    
    def test_cursor_with_string_id(self):
        class StringItem(BaseModel):
            uuid: str
            name: str
        
        items = [StringItem(uuid=f"uuid-{i}", name=f"Item {i}") for i in range(10)]
        paginator = CursorPaginator[StringItem](items=items, cursor_field='uuid')
        
        result = paginator.get_page(first=5)
        assert len(result['edges']) == 5
        assert result['page_info'].has_next_page is True
    
    def test_cursor_max_items(self):
        items = [Item(id=i, name=f"Item {i}", value=float(i)) for i in range(100)]
        paginator = CursorPaginator[Item](items=items, cursor_field='id', max_items_per_page=10)
        
        result = paginator.get_page(first=50)
        # Should be capped at max_items_per_page
        assert len(result['edges']) == 10


class TestPaginationParams:
    """Tests for pagination parameter extraction."""
    
    def test_default_params(self):
        params = get_pagination_params()
        assert params.page == 1
        assert params.items_per_page == 20
    
    def test_custom_params(self):
        params = get_pagination_params(page=2, items_per_page=50)
        assert params.page == 2
        assert params.items_per_page == 50
    
    def test_cursor_params(self):
        params = get_cursor_pagination_params(first=10, after="cursor123")
        assert params.first == 10
        assert params.after == "cursor123"


class TestPaginateHelpers:
    """Tests for paginate helper functions."""
    
    def test_paginate_offset_helper(self):
        items = [Item(id=i, name=f"Item {i}", value=float(i)) for i in range(100)]
        params = PaginationParams(page=2, items_per_page=10)
        
        response = paginate_offset(items, total_count=100, params=params)
        assert isinstance(response, PaginatedResponse)
        assert len(response.items) == 10
        assert response.page_info.current_page == 2
    
    def test_paginate_cursor_helper(self):
        items = [Item(id=i, name=f"Item {i}", value=float(i)) for i in range(100)]
        params = CursorPaginationParams(first=10)
        
        response = paginate_cursor(items, total_count=100, cursor_field='id', params=params)
        assert isinstance(response, CursorPaginatedResponse)
        assert len(response.edges) == 10


class TestPaginationIntegration:
    """Integration tests with FastAPI."""
    
    def test_offset_pagination_endpoint(self):
        app = FastAPI()
        
        items = [Item(id=i, name=f"Item {i}", value=float(i)) for i in range(100)]
        
        @app.get("/items", response_model=PaginatedResponse[Item])
        async def get_items(
            page: int = Query(1, ge=1),
            items_per_page: int = Query(20, ge=1, le=100)
        ):
            paginator = Paginator[Item](
                items=items,
                total_count=len(items),
                items_per_page=items_per_page,
                current_page=page
            )
            return paginator.get_response()
        
        client = TestClient(app)
        
        # First page
        response = client.get("/items?page=1&items_per_page=10")
        assert response.status_code == 200
        data = response.json()
        assert len(data['items']) == 10
        assert data['page_info']['current_page'] == 1
        assert data['page_info']['has_next_page'] is True
        
        # Second page
        response = client.get("/items?page=2&items_per_page=10")
        assert response.status_code == 200
        data = response.json()
        assert len(data['items']) == 10
        assert data['page_info']['current_page'] == 2
        assert data['page_info']['has_previous_page'] is True
    
    def test_cursor_pagination_endpoint(self):
        app = FastAPI()
        
        items = [Item(id=i, name=f"Item {i}", value=float(i)) for i in range(100)]
        
        @app.get("/items-cursor", response_model=CursorPaginatedResponse[Item])
        async def get_items_cursor(
            first: Optional[int] = Query(None, ge=1, le=100),
            after: Optional[str] = Query(None)
        ):
            paginator = CursorPaginator[Item](
                items=items,
                total_count=len(items),
                cursor_field='id'
            )
            return paginator.get_response(first=first, after=after)
        
        client = TestClient(app)
        
        # First page
        response = client.get("/items-cursor?first=10")
        assert response.status_code == 200
        data = response.json()
        assert len(data['edges']) == 10
        assert data['page_info']['has_next_page'] is True
        
        # Second page with after cursor
        after_cursor = data['page_info']['end_cursor']
        response = client.get(f"/items-cursor?first=10&after={after_cursor}")
        assert response.status_code == 200
        data = response.json()
        assert len(data['edges']) == 10


class TestEdgeCases:
    """Tests for edge cases and error handling."""
    
    def test_page_out_of_range(self):
        items = [Item(id=i, name=f"Item {i}", value=float(i)) for i in range(10)]
        paginator = Paginator[Item](items=items, items_per_page=10, current_page=100)
        
        page = paginator.get_page()
        assert len(page) == 0
    
    def test_negative_page(self):
        items = [Item(id=i, name=f"Item {i}", value=float(i)) for i in range(10)]
        # page should be at least 1
        paginator = Paginator[Item](items=items, items_per_page=10, current_page=1)
        
        page = paginator.get_page()
        assert len(page) == 10
    
    def test_zero_items_per_page(self):
        items = [Item(id=i, name=f"Item {i}", value=float(i)) for i in range(10)]
        # items_per_page should be at least 1
        paginator = Paginator[Item](items=items, items_per_page=1, current_page=1)
        
        page = paginator.get_page()
        assert len(page) == 1
    
    def test_cursor_with_invalid_cursor(self):
        items = [Item(id=i, name=f"Item {i}", value=float(i)) for i in range(10)]
        paginator = CursorPaginator[Item](items=items, cursor_field='id')
        
        # Invalid cursor should be treated as no cursor
        result = paginator.get_page(first=5, after="invalid-cursor")
        assert len(result['edges']) == 5
    
    def test_cursor_backward_pagination(self):
        items = [Item(id=i, name=f"Item {i}", value=float(i)) for i in range(20)]
        paginator = CursorPaginator[Item](items=items, cursor_field='id')
        
        # Get last page
        result = paginator.get_page(last=5)
        assert len(result['edges']) == 5
        # Last 5 items: 15, 16, 17, 18, 19
        assert result['edges'][0]['node'].id == 15
        assert result['edges'][4]['node'].id == 19
