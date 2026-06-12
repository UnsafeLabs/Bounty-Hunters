import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from fastapi.pagination import (
    CursorPaginatedResponse,
    Paginator,
    PaginatedResponse,
    _decode_cursor,
    _encode_cursor,
    paginate,
)


def test_paginator_skip_limit():
    p = Paginator(page=1, page_size=10)
    assert p.skip == 0
    assert p.limit == 10

    p2 = Paginator(page=3, page_size=10)
    assert p2.skip == 20
    assert p2.limit == 10


def test_paginate_basic():
    p = Paginator(page=1, page_size=10)
    result = p.paginate(list(range(10)), total=25)
    assert result.total == 25
    assert result.page == 1
    assert result.page_size == 10
    assert result.total_pages == 3
    assert result.has_next is True
    assert result.has_previous is False


def test_paginate_last_page():
    p = Paginator(page=3, page_size=10)
    result = p.paginate(list(range(5)), total=25)
    assert result.has_next is False
    assert result.has_previous is True


def test_paginate_middle_page():
    p = Paginator(page=2, page_size=10)
    result = p.paginate(list(range(10)), total=30)
    assert result.has_next is True
    assert result.has_previous is True


def test_paginate_empty_results():
    p = Paginator(page=1, page_size=10)
    result = p.paginate([], total=0)
    assert result.total == 0
    assert result.total_pages == 0
    assert result.has_next is False
    assert result.has_previous is False


def test_paginate_single_page():
    p = Paginator(page=1, page_size=10)
    result = p.paginate([1, 2, 3], total=3)
    assert result.total_pages == 1
    assert result.has_next is False
    assert result.has_previous is False


def test_encode_decode_cursor():
    cursor = _encode_cursor(20)
    assert _decode_cursor(cursor) == 20


def test_decode_invalid_cursor():
    assert _decode_cursor("not-valid-base64!!!") == 0


def test_paginate_cursor_first_page():
    p = Paginator(page=1, page_size=10)
    result = p.paginate_cursor(list(range(10)), total=25)
    assert result.has_next is True
    assert result.has_previous is False
    assert result.previous_cursor is None
    assert result.next_cursor is not None
    assert _decode_cursor(result.next_cursor) == 10


def test_paginate_cursor_last_page():
    p = Paginator(page=1, page_size=10)
    cursor = _encode_cursor(20)
    result = p.paginate_cursor(list(range(5)), total=25, cursor=cursor)
    assert result.has_next is False
    assert result.has_previous is True
    assert result.next_cursor is None
    assert result.previous_cursor is not None


def test_paginate_cursor_middle():
    p = Paginator(page=1, page_size=10)
    cursor = _encode_cursor(10)
    result = p.paginate_cursor(list(range(10)), total=30, cursor=cursor)
    assert result.has_next is True
    assert result.has_previous is True


def test_paginate_cursor_empty():
    p = Paginator(page=1, page_size=10)
    result = p.paginate_cursor([], total=0)
    assert result.has_next is False
    assert result.has_previous is False
    assert result.next_cursor is None
    assert result.previous_cursor is None


app = FastAPI()


@app.get("/items")
def get_items(p: Paginator = Depends(paginate)):
    all_items = list(range(100))
    page_items = all_items[p.skip : p.skip + p.limit]
    return p.paginate(page_items, total=len(all_items))


client = TestClient(app)


def test_endpoint_defaults():
    response = client.get("/items")
    assert response.status_code == 200
    data = response.json()
    assert data["page"] == 1
    assert data["page_size"] == 10
    assert data["total"] == 100
    assert data["total_pages"] == 10
    assert data["has_next"] is True
    assert data["has_previous"] is False


def test_endpoint_page_2():
    response = client.get("/items?page=2&page_size=10")
    assert response.status_code == 200
    data = response.json()
    assert data["page"] == 2
    assert data["has_next"] is True
    assert data["has_previous"] is True


def test_endpoint_last_page():
    response = client.get("/items?page=10&page_size=10")
    assert response.status_code == 200
    data = response.json()
    assert data["has_next"] is False
    assert data["has_previous"] is True


def test_endpoint_page_zero_rejected():
    response = client.get("/items?page=0")
    assert response.status_code == 422


def test_endpoint_negative_page_rejected():
    response = client.get("/items?page=-1")
    assert response.status_code == 422


def test_endpoint_page_size_zero_rejected():
    response = client.get("/items?page_size=0")
    assert response.status_code == 422
