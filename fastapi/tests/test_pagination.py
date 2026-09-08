"""
Tests for FastAPI pagination utilities.
"""

import pytest
from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient
from pydantic import BaseModel

from fastapi.pagination import (
    Paginator,
    CursorPaginator,
    PaginatedResponse,
    CursorPaginatedResponse,
    PageInfo,
    CursorPageInfo,
    paginate,
    cursor_paginate,
    encode_offset_cursor,
    decode_offset_cursor,
)


# Test models
class Item(BaseModel):
    id: int
    name: str


class TestPaginator:
    """Tests for the Paginator class."""
    
    def test_default_values(self):
        """Test default paginator values."""
        p = Paginator()
        assert p.page == 1
        assert p.page_size == 20
        assert p.max_page_size == 100
    
    def test_custom_values(self):
        """Test custom paginator values."""
        p = Paginator(page=2, page_size=10, max_page_size=50)
        assert p.page == 2
        assert p.page_size == 10
        assert p.max_page_size == 50
    
    def test_negative_page_normalized(self):
        """Test that negative page is normalized to 1."""
        p = Paginator(page=-5)
        assert p.page == 1
    
    def test_zero_page_normalized(self):
        """Test that page 0 is normalized to 1."""
        p = Paginator(page=0)
        assert p.page == 1
    
    def test_negative_page_size_normalized(self):
        """Test that negative page_size is normalized to 1."""
        p = Paginator(page_size=-5)
        assert p.page_size == 1
    
    def test_page_size_exceeds_max(self):
        """Test that page_size exceeding max is capped."""
        p = Paginator(page_size=150, max_page_size=100)
        assert p.page_size == 100
    
    def test_get_offset_limit(self):
        """Test offset/limit calculation."""
        p = Paginator(page=2, page_size=10)
        skip, limit = p.get_offset_limit()
        assert skip == 10
        assert limit == 10
    
    def test_get_offset_limit_page_1(self):
        """Test offset/limit for page 1."""
        p = Paginator(page=1, page_size=20)
        skip, limit = p.get_offset_limit()
        assert skip == 0
        assert limit == 20
    
    def test_create_page_info(self):
        """Test page info creation."""
        p = Paginator(page=2, page_size=10)
        page_info = p.create_page_info(total=50)
        
        assert page_info.page == 2
        assert page_info.page_size == 10
        assert page_info.total == 50
        assert page_info.total_pages == 5
    
    def test_create_page_info_empty(self):
        """Test page info with empty results."""
        p = Paginator(page=1, page_size=10)
        page_info = p.create_page_info(total=0)
        
        assert page_info.total == 0
        assert page_info.total_pages == 1
    
    def test_create_paginated_response(self):
        """Test paginated response creation."""
        p = Paginator(page=1, page_size=10)
        items = [Item(id=i, name=f"Item {i}") for i in range(10)]
        
        response = p.create_paginated_response(items, total=50)
        
        assert len(response.items) == 10
        assert response.page_info.page == 1
        assert response.page_info.page_size == 10
        assert response.page_info.total == 50
        assert response.page_info.total_pages == 5


class TestCursorPaginator:
    """Tests for the CursorPaginator class."""
    
    def test_default_values(self):
        """Test default cursor paginator values."""
        p = CursorPaginator()
        assert p.cursor is None
        assert p.page_size == 20
        assert p.max_page_size == 100
    
    def test_custom_values(self):
        """Test custom cursor paginator values."""
        p = CursorPaginator(cursor="abc123", page_size=10, max_page_size=50)
        assert p.cursor == "abc123"
        assert p.page_size == 10
        assert p.max_page_size == 50
    
    def test_get_cursor_value(self):
        """Test cursor value decoding."""
        p = CursorPaginator(cursor="test_cursor")
        # With default decode function (identity)
        assert p.get_cursor_value() == "test_cursor"
    
    def test_get_cursor_value_none(self):
        """Test cursor value when None."""
        p = CursorPaginator(cursor=None)
        assert p.get_cursor_value() is None
    
    def test_create_cursor_page_info(self):
        """Test cursor page info creation."""
        p = CursorPaginator(cursor="abc")
        page_info = p.create_cursor_page_info(has_next=True, has_previous=False, total=100)
        
        assert page_info.cursor == "abc"
        assert page_info.has_next is True
        assert page_info.has_previous is False
        assert page_info.total == 100
    
    def test_create_cursor_paginated_response(self):
        """Test cursor paginated response creation."""
        p = CursorPaginator(cursor="abc")
        items = [Item(id=i, name=f"Item {i}") for i in range(10)]
        
        response = p.create_cursor_paginated_response(
            items, has_next=True, has_previous=False, total=100
        )
        
        assert len(response.items) == 10
        assert response.page_info.cursor == "abc"
        assert response.page_info.has_next is True
        assert response.page_info.has_previous is False


class TestCursorEncoding:
    """Tests for cursor encoding/decoding utilities."""
    
    def test_encode_decode_cursor(self):
        """Test cursor encoding and decoding."""
        offset = 12345
        encoded = encode_offset_cursor(offset)
        decoded = decode_offset_cursor(encoded)
        assert decoded == offset
    
    def test_encode_decode_zero(self):
        """Test encoding/decoding zero."""
        encoded = encode_offset_cursor(0)
        decoded = decode_offset_cursor(encoded)
        assert decoded == 0
    
    def test_decode_invalid_cursor(self):
        """Test decoding invalid cursor returns 0."""
        decoded = decode_offset_cursor("invalid!!!")
        assert decoded == 0


class TestPaginatedResponse:
    """Tests for PaginatedResponse model."""
    
    def test_paginated_response_with_items(self):
        """Test paginated response with items."""
        items = [Item(id=i, name=f"Item {i}") for i in range(5)]
        page_info = PageInfo(page=1, page_size=5, total=20, total_pages=4)
        
        response = PaginatedResponse[Item](items=items, page_info=page_info)
        
        assert len(response.items) == 5
        assert response.page_info.page == 1
        assert response.page_info.total_pages == 4


class TestCursorPaginatedResponse:
    """Tests for CursorPaginatedResponse model."""
    
    def test_cursor_paginated_response(self):
        """Test cursor paginated response."""
        items = [Item(id=i, name=f"Item {i}") for i in range(5)]
        page_info = CursorPageInfo(
            cursor="abc123",
            has_next=True,
            has_previous=False,
            total=100
        )
        
        response = CursorPaginatedResponse[Item](items=items, page_info=page_info)
        
        assert len(response.items) == 5
        assert response.page_info.has_next is True


# Integration tests with FastAPI

app = FastAPI()


@app.get("/items", response_model=PaginatedResponse[Item])
async def get_items(
    paginator: Paginator = Depends(paginate)
):
    """Test endpoint with pagination."""
    # Simulate database query
    all_items = [Item(id=i, name=f"Item {i}") for i in range(100)]
    skip, limit = paginator.get_offset_limit()
    items = all_items[skip:skip + limit]
    return paginator.create_paginated_response(items, total=100)


@app.get("/items-cursor", response_model=CursorPaginatedResponse[Item])
async def get_items_cursor(
    cursor_paginator: CursorPaginator = Depends(cursor_paginate)
):
    """Test endpoint with cursor pagination."""
    all_items = [Item(id=i, name=f"Item {i}") for i in range(100)]
    
    # Get cursor offset
    cursor_value = cursor_paginator.get_cursor_value()
    offset = int(cursor_value) if cursor_value else 0
    
    items = all_items[offset:offset + cursor_paginator.page_size]
    has_next = (offset + cursor_paginator.page_size) < 100
    has_previous = offset > 0
    
    return cursor_paginator.create_cursor_paginated_response(
        items, has_next=has_next, has_previous=has_previous, total=100
    )


@pytest.fixture
def client():
    """Create test client."""
    return TestClient(app)


class TestFastAPIIntegration:
    """Integration tests with FastAPI."""
    
    def test_pagination_endpoint(self, client):
        """Test pagination endpoint."""
        response = client.get("/items?page=1&page_size=10")
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 10
        assert data["page_info"]["page"] == 1
        assert data["page_info"]["page_size"] == 10
        assert data["page_info"]["total"] == 100
        assert data["page_info"]["total_pages"] == 10
    
    def test_pagination_page_2(self, client):
        """Test pagination page 2."""
        response = client.get("/items?page=2&page_size=10")
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 10
        assert data["page_info"]["page"] == 2
        # First item on page 2 should have id=10
        assert data["items"][0]["id"] == 10
    
    def test_pagination_defaults(self, client):
        """Test pagination with default values."""
        response = client.get("/items")
        assert response.status_code == 200
        data = response.json()
        assert data["page_info"]["page"] == 1
        assert data["page_info"]["page_size"] == 20
    
    def test_cursor_pagination_endpoint(self, client):
        """Test cursor pagination endpoint."""
        response = client.get("/items-cursor?page_size=10")
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 10
        assert data["page_info"]["has_next"] is True
        assert data["page_info"]["has_previous"] is False
    
    def test_cursor_pagination_with_cursor(self, client):
        """Test cursor pagination with cursor parameter."""
        # First get page 1
        response1 = client.get("/items-cursor?page_size=10")
        data1 = response1.json()
        
        # Get page 2 using offset cursor
        # Encode offset 10 as cursor
        cursor = encode_offset_cursor(10)
        response2 = client.get(f"/items-cursor?cursor={cursor}&page_size=10")
        assert response2.status_code == 200
        data2 = response2.json()
        assert len(data2["items"]) == 10
        assert data2["items"][0]["id"] == 10
        assert data2["page_info"]["has_previous"] is True
