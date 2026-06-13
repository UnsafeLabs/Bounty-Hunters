from fastapi import FastAPI
from fastapi.pagination import (
    CursorPaginatedResponse,
    PaginatedResponse,
    Paginator,
    paginate,
)
from fastapi.testclient import TestClient
from pydantic import BaseModel

app = FastAPI()


class Item(BaseModel):
    id: int
    name: str


ITEMS = [Item(id=i, name=f"Item {i}") for i in range(1, 101)]


@app.get("/items", response_model=PaginatedResponse[Item])
async def list_items(params: Paginator = paginate):
    total = len(ITEMS)
    end = params.skip + params.limit
    items = ITEMS[params.skip : end]
    return params.response(items, total)


client = TestClient(app)


def test_default_page_and_page_size():
    response = client.get("/items")
    assert response.status_code == 200
    data = response.json()
    assert data["page"] == 1
    assert data["page_size"] == 20
    assert data["total"] == 100
    assert data["total_pages"] == 5
    assert len(data["items"]) == 20


def test_specific_page():
    response = client.get("/items?page=2")
    assert response.status_code == 200
    data = response.json()
    assert data["page"] == 2
    assert data["total_pages"] == 5
    assert data["items"][0]["id"] == 21
    assert data["has_previous"] is True
    assert data["has_next"] is True


def test_last_page():
    response = client.get("/items?page=5")
    assert response.status_code == 200
    data = response.json()
    assert data["page"] == 5
    assert data["has_next"] is False
    assert data["has_previous"] is True
    assert len(data["items"]) == 20


def test_single_page_all_results():
    response = client.get("/items?page_size=100")
    assert response.status_code == 200
    data = response.json()
    assert data["page_size"] == 100
    assert data["total_pages"] == 1
    assert data["has_next"] is False
    assert data["has_previous"] is False
    assert len(data["items"]) == 100


def test_custom_page_size():
    response = client.get("/items?page_size=10")
    assert response.status_code == 200
    data = response.json()
    assert data["page_size"] == 10
    assert data["total_pages"] == 10
    assert len(data["items"]) == 10


def test_page_zero_is_treated_as_one():
    response = client.get("/items?page=0")
    assert response.status_code == 200
    data = response.json()
    assert data["page"] == 1


def test_negative_page_is_treated_as_one():
    response = client.get("/items?page=-1")
    assert response.status_code == 200
    data = response.json()
    assert data["page"] == 1


def test_page_size_zero_defaults_to_twenty():
    response = client.get("/items?page_size=0")
    assert response.status_code == 200
    data = response.json()
    assert data["page_size"] == 20


def test_negative_page_size_defaults_to_twenty():
    response = client.get("/items?page_size=-5")
    assert response.status_code == 200
    data = response.json()
    assert data["page_size"] == 20


def test_empty_results():
    """Test with empty data source."""
    result = Paginator.paginate_offset([], 0, 1, 20)
    assert result.items == []
    assert result.total == 0
    assert result.total_pages == 1
    assert result.has_next is False
    assert result.has_previous is False


def test_offset_pagination_correctly_calculates_skip_and_limit():
    params = Paginator(page=3, page_size=10)
    assert params.skip == 20
    assert params.limit == 10


def test_offset_out_of_bounds_returns_empty():
    response = client.get("/items?page=100&page_size=10")
    assert response.status_code == 200
    data = response.json()
    assert data["page"] == 100
    assert data["total_pages"] == 10
    assert data["has_next"] is False
    assert len(data["items"]) == 0


def test_paginated_response_works_with_any_pydantic_model():
    class OtherModel(BaseModel):
        value: str

    result = PaginatedResponse[OtherModel](
        items=[OtherModel(value="a"), OtherModel(value="b")],
        total=2,
        page=1,
        page_size=10,
        total_pages=1,
        has_next=False,
        has_previous=False,
    )
    assert len(result.items) == 2
    assert result.items[0].value == "a"


# --- Cursor-based pagination tests ---


def test_cursor_pagination_basic():
    items = ITEMS[:10]
    result = Paginator.paginate_cursor(
        items=items,
        cursor=None,
        page_size=10,
        has_more=True,
    )
    assert len(result.items) == 10
    assert result.cursor is None
    assert result.next_cursor is not None
    assert result.has_next is True
    assert result.has_previous is False
    assert result.previous_cursor is None


def test_cursor_pagination_no_more_results():
    items = ITEMS[:5]
    result = Paginator.paginate_cursor(
        items=items,
        cursor="some-cursor",
        page_size=5,
        has_more=False,
    )
    assert result.has_next is False
    assert result.next_cursor is None


def test_cursor_pagination_with_previous():
    result = Paginator.paginate_cursor(
        items=ITEMS[:5],
        cursor="cursor-2",
        page_size=5,
        has_more=True,
        previous_cursor="cursor-1",
    )
    assert result.has_previous is True
    assert result.previous_cursor == "cursor-1"


def test_cursor_pagination_empty_items():
    result = Paginator.paginate_cursor(
        items=[],
        cursor=None,
        page_size=20,
        has_more=False,
    )
    assert result.items == []
    assert result.has_next is False
    assert result.next_cursor is None


def test_cursor_paginated_response_type_works():
    class OtherModel(BaseModel):
        value: str

    result = CursorPaginatedResponse[OtherModel](
        items=[OtherModel(value="test")],
        cursor="abc",
        next_cursor="def",
        has_next=True,
        has_previous=False,
    )
    assert len(result.items) == 1
    assert result.items[0].value == "test"
    assert result.next_cursor == "def"
