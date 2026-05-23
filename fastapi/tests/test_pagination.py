from fastapi import FastAPI, Depends
from fastapi.pagination import Paginator, PaginatedResponse, paginate
from fastapi.testclient import TestClient


def test_paginator_defaults():
    p = Paginator()
    assert p.page == 1
    assert p.page_size == 20
    assert p.skip() == 0
    assert p.limit() == 20


def test_paginator_custom():
    p = Paginator(page=3, page_size=10)
    assert p.page == 3
    assert p.page_size == 10
    assert p.skip() == 20
    assert p.limit() == 10


def test_paginator_negative_values():
    p = Paginator(page=0, page_size=0)
    assert p.page == 1
    assert p.page_size == 20


def test_paginate_first_page():
    p = Paginator(page=1, page_size=10)
    items = list(range(10))
    result = p.paginate(items, 100)
    assert result.items == items
    assert result.total == 100
    assert result.page == 1
    assert result.page_size == 10
    assert result.total_pages == 10
    assert result.has_next is True
    assert result.has_previous is False
    assert result.next_cursor is not None
    assert result.previous_cursor is None


def test_paginate_middle_page():
    p = Paginator(page=5, page_size=10)
    items = list(range(10))
    result = p.paginate(items, 100)
    assert result.page == 5
    assert result.has_next is True
    assert result.has_previous is True
    assert result.next_cursor is not None
    assert result.previous_cursor is not None


def test_paginate_last_page():
    p = Paginator(page=10, page_size=10)
    items = list(range(10))
    result = p.paginate(items, 100)
    assert result.page == 10
    assert result.has_next is False
    assert result.has_previous is True
    assert result.next_cursor is None
    assert result.previous_cursor is not None


def test_paginate_empty():
    p = Paginator(page=1, page_size=10)
    result = p.paginate([], 0)
    assert result.items == []
    assert result.total == 0
    assert result.total_pages == 0
    assert result.has_next is False
    assert result.has_previous is False


def test_paginate_single_page():
    p = Paginator(page=1, page_size=10)
    result = p.paginate([1, 2, 3], 3)
    assert result.total_pages == 1
    assert result.has_next is False
    assert result.has_previous is False


def test_cursor_roundtrip():
    p = Paginator(page=5, page_size=10)
    result = p.paginate(list(range(10)), 100)
    cursor = result.next_cursor
    decoded = Paginator.decode_cursor(cursor)
    assert decoded == 6

    p2 = Paginator.from_cursor(cursor, page_size=10)
    assert p2.page == 6
    assert p2.page_size == 10


def test_paginate_function():
    result = paginate(1, 20)
    assert isinstance(result, Paginator)
    assert result.page == 1
    assert result.page_size == 20


app = FastAPI()


@app.get("/items")
def list_items(p: Paginator = Depends(paginate)):
    all_items = list(range(100))
    skip = p.skip()
    limit = p.limit()
    return p.paginate(all_items[skip:skip + limit], len(all_items))


@app.get("/items-small")
def list_items_small(p: Paginator = Depends(paginate)):
    all_items = [1, 2, 3]
    return p.paginate(all_items, len(all_items))


client = TestClient(app)


def test_integration_default():
    response = client.get("/items")
    assert response.status_code == 200
    data = response.json()
    assert data["page"] == 1
    assert data["page_size"] == 20
    assert data["total"] == 100
    assert data["total_pages"] == 5
    assert data["has_next"] is True
    assert data["has_previous"] is False
    assert len(data["items"]) == 20


def test_integration_page_2():
    response = client.get("/items?page=2")
    assert response.status_code == 200
    data = response.json()
    assert data["page"] == 2
    assert data["has_next"] is True
    assert data["has_previous"] is True
    assert len(data["items"]) == 20


def test_integration_last_page():
    response = client.get("/items?page=5")
    assert response.status_code == 200
    data = response.json()
    assert data["page"] == 5
    assert data["total_pages"] == 5
    assert data["has_next"] is False
    assert data["has_previous"] is True
    assert len(data["items"]) == 20


def test_integration_custom_page_size():
    response = client.get("/items?page=1&page_size=50")
    assert response.status_code == 200
    data = response.json()
    assert data["page_size"] == 50
    assert data["total_pages"] == 2
    assert len(data["items"]) == 50


def test_integration_empty():
    response = client.get("/items?page=999")
    assert response.status_code == 200
    data = response.json()
    assert data["items"] == []
    assert data["total"] == 100


def test_integration_small():
    response = client.get("/items-small")
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 3
    assert data["total_pages"] == 1
    assert data["has_next"] is False
    assert data["has_previous"] is False


def test_integration_page_0_is_rejected():
    response = client.get("/items?page=0")
    assert response.status_code == 422


def test_integration_page_size_0_is_rejected():
    response = client.get("/items?page_size=0")
    assert response.status_code == 422


def test_integration_page_size_too_large():
    response = client.get("/items?page_size=200")
    assert response.status_code == 422
