from fastapi import Depends, FastAPI
from fastapi.pagination import (
    CursorPage,
    CursorParams,
    PaginatedResponse,
    PaginationParams,
    decode_cursor,
    encode_cursor,
    paginate,
)
from fastapi.testclient import TestClient
from pydantic import BaseModel


class Item(BaseModel):
    id: int
    name: str


SAMPLE_ITEMS = [Item(id=i, name=f"item-{i}") for i in range(1, 101)]


def test_paginate_first_page():
    result = paginate(SAMPLE_ITEMS[:20], 100, PaginationParams(page=1, page_size=20))
    assert result.total == 100
    assert result.page == 1
    assert result.page_size == 20
    assert result.total_pages == 5
    assert result.has_next is True
    assert result.has_previous is False
    assert len(result.items) == 20


def test_paginate_last_page():
    result = paginate(SAMPLE_ITEMS[80:], 100, PaginationParams(page=5, page_size=20))
    assert result.total == 100
    assert result.page == 5
    assert result.total_pages == 5
    assert result.has_next is False
    assert result.has_previous is True
    assert len(result.items) == 20


def test_paginate_middle_page():
    result = paginate(SAMPLE_ITEMS[40:60], 100, PaginationParams(page=3, page_size=20))
    assert result.page == 3
    assert result.has_next is True
    assert result.has_previous is True


def test_paginate_single_page():
    result = paginate(SAMPLE_ITEMS[:5], 5, PaginationParams(page=1, page_size=5))
    assert result.total_pages == 1
    assert result.has_next is False
    assert result.has_previous is False


def test_paginate_empty():
    result = paginate([], 0, PaginationParams(page=1, page_size=20))
    assert result.total == 0
    assert result.total_pages == 0
    assert result.has_next is False
    assert result.has_previous is False
    assert result.items == []


def test_paginate_partial_page():
    result = paginate(SAMPLE_ITEMS[:15], 15, PaginationParams(page=1, page_size=20))
    assert result.total_pages == 1
    assert len(result.items) == 15


def test_paginate_exact_page_size():
    result = paginate(SAMPLE_ITEMS[:10], 10, PaginationParams(page=1, page_size=10))
    assert result.total_pages == 1


def test_pagination_params_skip():
    p = PaginationParams(page=1, page_size=20)
    assert p.skip == 0
    assert p.limit == 20

    p = PaginationParams(page=3, page_size=10)
    assert p.skip == 20
    assert p.limit == 10


def test_pagination_params_negative_page_via_query():
    """Validation happens via FastAPI Query, not at construction."""
    p = PaginationParams(page=0, page_size=20)
    assert p.skip == -20

def test_pagination_params_page_size_zero():
    p = PaginationParams(page=1, page_size=0)
    assert p.limit == 0

def test_pagination_params_page_size_large():
    p = PaginationParams(page=1, page_size=101)
    assert p.limit == 101


def test_encode_decode_cursor():
    original = "abc123"
    encoded = encode_cursor(original)
    assert isinstance(encoded, str)
    assert decode_cursor(encoded) == original


def test_encode_decode_cursor_int():
    original = 42
    encoded = encode_cursor(original)
    assert decode_cursor(encoded) == "42"


def test_cursor_page_model():
    page = CursorPage[Item](
        items=[Item(id=1, name="a")],
        cursor=encode_cursor("1"),
        limit=20,
        has_next=True,
    )
    assert page.items[0].id == 1
    assert page.cursor is not None
    assert page.has_next is True
    assert page.limit == 20


def test_paginated_response_generic():
    """PaginatedResponse works with any Pydantic model."""
    items = [Item(id=1, name="test")]
    result = PaginatedResponse[Item](
        items=items, total=1, page=1, page_size=20,
        total_pages=1, has_next=False, has_previous=False,
    )
    assert isinstance(result.items[0], Item)


def test_paginated_response_diff_model():
    """PaginatedResponse works with different Pydantic models."""

    class Product(BaseModel):
        sku: str
        price: float

    result = PaginatedResponse[Product](
        items=[Product(sku="ABC", price=9.99)],
        total=1, page=1, page_size=10,
        total_pages=1, has_next=False, has_previous=False,
    )
    assert result.items[0].sku == "ABC"
    assert result.items[0].price == 9.99


def test_paginate_inconsistent_page():
    """Passing a page beyond the total returns empty items."""
    result = paginate([], 100, PaginationParams(page=999, page_size=20))
    assert result.page == 999
    assert result.has_next is False
    assert result.has_previous is True
    assert len(result.items) == 0


# --- integration tests with FastAPI app ---

app = FastAPI()


@app.get("/items", response_model=PaginatedResponse[Item])
def list_items(params: PaginationParams = Depends()):
    return paginate(SAMPLE_ITEMS[params.skip : params.skip + params.limit], len(SAMPLE_ITEMS), params)


client = TestClient(app)


def test_integration_defaults():
    response = client.get("/items")
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 100
    assert data["page"] == 1
    assert data["page_size"] == 20
    assert data["total_pages"] == 5
    assert data["has_next"] is True
    assert data["has_previous"] is False
    assert len(data["items"]) == 20


def test_integration_page_3():
    response = client.get("/items?page=3&page_size=10")
    assert response.status_code == 200
    data = response.json()
    assert data["page"] == 3
    assert data["page_size"] == 10
    assert data["total_pages"] == 10
    assert data["has_next"] is True
    assert data["has_previous"] is True
    assert len(data["items"]) == 10
    assert data["items"][0]["id"] == 21


def test_integration_last_page():
    response = client.get("/items?page=10&page_size=10")
    assert response.status_code == 200
    data = response.json()
    assert data["has_next"] is False
    assert data["has_previous"] is True
    assert len(data["items"]) == 10


def test_integration_first_page_has_no_previous():
    response = client.get("/items?page=1")
    assert response.status_code == 200
    assert response.json()["has_previous"] is False


def test_integration_single_item_page():
    response = client.get("/items?page=1&page_size=1")
    assert response.status_code == 200
    data = response.json()
    assert len(data["items"]) == 1
    assert data["total_pages"] == 100
    assert data["has_next"] is True


def test_integration_page_0_returns_422():
    response = client.get("/items?page=0")
    assert response.status_code == 422


def test_integration_negative_page_returns_422():
    response = client.get("/items?page=-1")
    assert response.status_code == 422


def test_integration_page_size_0_returns_422():
    response = client.get("/items?page_size=0")
    assert response.status_code == 422


def test_integration_page_size_too_large_returns_422():
    response = client.get("/items?page_size=101")
    assert response.status_code == 422


def test_integration_empty_items():
    """By default no data returns empty items with correct metadata."""
    response = client.get("/items?page=999&page_size=20")
    assert response.status_code == 200
    data = response.json()
    assert data["items"] == []
    assert data["page"] == 999
    assert data["has_next"] is False
    assert data["has_previous"] is True
