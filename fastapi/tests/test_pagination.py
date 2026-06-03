"""Tests for FastAPI Pagination."""
import sys
sys.path.insert(0, "fastapi")
import pytest
from fastapi.pagination import Paginator, PaginationParams, paginate, PaginatedResponse
from pydantic import BaseModel


class Item(BaseModel):
    id: int
    name: str


def test_pagination_params_defaults():
    params = PaginationParams()
    assert params.page == 1
    assert params.page_size == 20


def test_pagination_params_negative():
    params = PaginationParams(page=-1)
    assert params.page == 1


def test_pagination_params_custom():
    params = PaginationParams(page=3, page_size=50)
    assert params.page == 3
    assert params.page_size == 50


def test_encoded_cursor():
    paginator = Paginator(page=1, page_size=10)
    cursor = paginator._encode_cursor({"value": 5, "direction": "next"})
    decoded = paginator._decode_cursor(cursor)
    assert decoded["value"] == 5
    assert decoded["direction"] == "next"


def test_paginated_response():
    items = [Item(id=i, name=f"item_{i}") for i in range(1, 21)]
    response = PaginatedResponse(
        items=items, total=100, page=1, page_size=20,
        total_pages=5, has_next=True, has_previous=False
    )
    assert len(response.items) == 20
    assert response.has_next is True
    assert response.has_previous is False


def test_last_page():
    response = PaginatedResponse(
        items=[], total=100, page=5, page_size=20,
        total_pages=5, has_next=False, has_previous=True
    )
    assert response.has_next is False
    assert response.has_previous is True


def test_create_paginated_response():
    from fastapi.pagination import create_paginated_response
    items = [Item(id=i, name=f"item_{i}") for i in range(1, 11)]
    response = create_paginated_response(items=items, total=50, page=1, page_size=10)
    assert response.total_pages == 5
    assert response.has_next is True
