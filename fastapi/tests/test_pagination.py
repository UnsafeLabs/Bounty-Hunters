import math

import pytest
from fastapi import FastAPI
from fastapi.pagination import PaginatedResponse, PaginationParams, Paginator
from fastapi.testclient import TestClient
from pydantic import BaseModel

app = FastAPI()


class Item(BaseModel):
    id: int
    name: str


ITEMS = [Item(id=i, name=f"Item {i}") for i in range(1, 101)]


@app.get("/items-offset")
async def get_items_offset(page: int = 1, page_size: int = 20):
    paginator = Paginator(page=page, page_size=page_size)
    return paginator.offset_paginate(ITEMS, total=len(ITEMS))


@app.get("/items-cursor")
async def get_items_cursor(page_size: int = 20):
    paginator = Paginator(page=1, page_size=page_size)
    return paginator.cursor_paginate(ITEMS, total=len(ITEMS))


@app.get("/items-paginate")
async def get_items_paginate(page: int = 1, page_size: int = 20):
    from fastapi.pagination import paginate

    return paginate(ITEMS, page=page, page_size=page_size, total=len(ITEMS))


client = TestClient(app)


def test_offset_pagination_default():
    response = client.get("/items-offset")
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 100
    assert data["page"] == 1
    assert data["page_size"] == 20
    assert data["total_pages"] == 5
    assert data["has_next"] is True
    assert data["has_previous"] is False
    assert len(data["items"]) == 20
    assert data["items"][0]["id"] == 1
    assert data["items"][-1]["id"] == 20


def test_offset_pagination_page_2():
    response = client.get("/items-offset?page=2")
    assert response.status_code == 200
    data = response.json()
    assert data["page"] == 2
    assert data["has_next"] is True
    assert data["has_previous"] is True
    assert len(data["items"]) == 20
    assert data["items"][0]["id"] == 21
    assert data["items"][-1]["id"] == 40


def test_offset_pagination_last_page():
    response = client.get("/items-offset?page=5")
    assert response.status_code == 200
    data = response.json()
    assert data["page"] == 5
    assert data["has_next"] is False
    assert data["has_previous"] is True
    assert len(data["items"]) == 20
    assert data["items"][0]["id"] == 81
    assert data["items"][-1]["id"] == 100


def test_offset_pagination_custom_size():
    response = client.get("/items-offset?page=1&page_size=10")
    assert response.status_code == 200
    data = response.json()
    assert data["page_size"] == 10
    assert data["total_pages"] == 10
    assert len(data["items"]) == 10


def test_paginate_function():
    response = client.get("/items-paginate?page=1&page_size=10")
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 100
    assert data["page_size"] == 10
    assert len(data["items"]) == 10


def test_cursor_pagination():
    response = client.get("/items-cursor?page_size=10")
    assert response.status_code == 200
    data = response.json()
    assert data["page"] == 1
    assert data["total"] == 100
    assert len(data["items"]) == 10


def test_empty_items():
    paginator = Paginator(page=1, page_size=20)
    result = paginator.offset_paginate([], total=0)
    assert result.total == 0
    assert result.items == []
    assert result.total_pages == 1
    assert result.has_next is False
    assert result.has_previous is False


def test_single_item():
    paginator = Paginator(page=1, page_size=20)
    result = paginator.offset_paginate([Item(id=1, name="Only")], total=1)
    assert result.total == 1
    assert len(result.items) == 1
    assert result.total_pages == 1
    assert result.has_next is False


def test_exact_fit():
    items = [Item(id=i, name=f"Item {i}") for i in range(1, 21)]
    paginator = Paginator(page=1, page_size=20)
    result = paginator.offset_paginate(items, total=20)
    assert result.total == 20
    assert result.total_pages == 1
    assert result.has_next is False


def test_boundary_page_beyond_total():
    paginator = Paginator(page=10, page_size=20)
    result = paginator.offset_paginate(ITEMS, total=100)
    assert len(result.items) == 0


def test_encode_decode_cursor():
    encoded = Paginator.encode_cursor("42")
    assert isinstance(encoded, str)
    decoded = Paginator.decode_cursor(encoded)
    assert decoded == "42"


def test_decode_invalid_cursor():
    result = Paginator.decode_cursor("!!!invalid!!!")
    assert result == ""


def test_paginator_negative_page():
    paginator = Paginator(page=-1, page_size=20)
    assert paginator.page == 1


def test_paginator_zero_page_size():
    paginator = Paginator(page=1, page_size=0)
    assert paginator.page_size == 20
