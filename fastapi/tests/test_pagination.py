from typing import Annotated

import pytest
from fastapi import (
    CursorPaginatedResponse,
    CursorPaginator,
    Depends,
    FastAPI,
    PaginatedResponse,
    Paginator,
    paginate,
    paginate_cursor,
)
from fastapi.pagination import decode_cursor, encode_cursor
from fastapi.testclient import TestClient
from pydantic import BaseModel


class Item(BaseModel):
    id: int
    name: str


ITEMS = [Item(id=i, name=f"item-{i}") for i in range(25)]


app = FastAPI()


@app.get("/items", response_model=PaginatedResponse[Item])
def list_items(pager: Annotated[Paginator, Depends(paginate)]):
    window = ITEMS[pager.offset : pager.offset + pager.limit]
    return pager.paginate(window, total=len(ITEMS))


@app.get("/items/cursor", response_model=CursorPaginatedResponse[Item])
def list_items_cursor(pager: Annotated[CursorPaginator, Depends(paginate_cursor)]):
    window = ITEMS[pager.offset : pager.offset + pager.limit]
    return pager.paginate(window, total=len(ITEMS))


client = TestClient(app)


# --- Offset paginator unit tests -------------------------------------------


def test_offset_skip_and_limit():
    pager = Paginator(page=3, page_size=10)
    assert pager.offset == 20
    assert pager.skip == 20
    assert pager.limit == 10


def test_offset_totals_and_flags_middle_page():
    pager = Paginator(page=2, page_size=10)
    result = pager.paginate(ITEMS[10:20], total=25)
    assert result.total == 25
    assert result.page == 2
    assert result.page_size == 10
    assert result.total_pages == 3
    assert result.has_previous is True
    assert result.has_next is True
    assert len(result.items) == 10


def test_offset_flags_at_first_page():
    pager = Paginator(page=1, page_size=10)
    result = pager.paginate(ITEMS[0:10], total=25)
    assert result.has_previous is False
    assert result.has_next is True


def test_offset_flags_at_last_page():
    pager = Paginator(page=3, page_size=10)
    result = pager.paginate(ITEMS[20:25], total=25)
    assert result.has_previous is True
    assert result.has_next is False
    assert result.total_pages == 3
    assert len(result.items) == 5


def test_offset_exact_multiple_total_pages():
    pager = Paginator(page=1, page_size=5)
    result = pager.paginate(ITEMS[0:5], total=20)
    assert result.total_pages == 4


# --- Offset edge cases ------------------------------------------------------


def test_offset_page_zero_normalized():
    pager = Paginator(page=0, page_size=10)
    assert pager.page == 1
    assert pager.offset == 0


def test_offset_negative_page_normalized():
    pager = Paginator(page=-5, page_size=10)
    assert pager.page == 1
    assert pager.offset == 0


def test_offset_page_size_zero_uses_default():
    pager = Paginator(page=1, page_size=0)
    assert pager.page_size == 50


def test_offset_page_size_capped_at_max():
    pager = Paginator(page=1, page_size=10_000)
    assert pager.page_size == 100


def test_offset_empty_results():
    pager = Paginator(page=1, page_size=10)
    result = pager.paginate([], total=0)
    assert result.items == []
    assert result.total == 0
    assert result.total_pages == 0
    assert result.has_next is False
    assert result.has_previous is False


def test_offset_page_beyond_range_has_previous():
    pager = Paginator(page=99, page_size=10)
    result = pager.paginate([], total=25)
    assert result.has_next is False
    assert result.has_previous is True


# --- Generic response model -------------------------------------------------


def test_paginated_response_is_generic_over_any_model():
    class Other(BaseModel):
        value: str

    response = PaginatedResponse[Other](
        items=[Other(value="x")],
        total=1,
        page=1,
        page_size=10,
        total_pages=1,
        has_next=False,
        has_previous=False,
    )
    assert response.items[0].value == "x"


# --- paginate dependency via the HTTP layer --------------------------------


def test_paginate_dependency_defaults():
    response = client.get("/items")
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["page"] == 1
    assert data["page_size"] == 50
    assert data["total"] == 25
    assert data["total_pages"] == 1
    assert data["has_next"] is False
    assert data["has_previous"] is False
    assert len(data["items"]) == 25


def test_paginate_dependency_reads_query_params():
    response = client.get("/items", params={"page": 2, "page_size": 10})
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["page"] == 2
    assert data["page_size"] == 10
    assert [item["id"] for item in data["items"]] == list(range(10, 20))
    assert data["has_next"] is True
    assert data["has_previous"] is True


def test_paginate_dependency_normalizes_bad_query_params():
    response = client.get("/items", params={"page": 0, "page_size": 0})
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["page"] == 1
    assert data["page_size"] == 50


# --- Cursor pagination ------------------------------------------------------


def test_cursor_round_trip():
    cursor = encode_cursor({"offset": 30})
    assert decode_cursor(cursor) == {"offset": 30}


def test_decode_invalid_cursor_raises_value_error():
    with pytest.raises(ValueError):
        decode_cursor("!!!not-base64!!!")


def test_cursor_first_page_has_next_no_previous():
    pager = CursorPaginator(page_size=10)
    result = pager.paginate(ITEMS[0:10], total=25)
    assert result.has_previous is False
    assert result.has_next is True
    assert result.previous_cursor is None
    assert result.next_cursor is not None
    assert decode_cursor(result.next_cursor) == {"offset": 10}


def test_cursor_navigates_to_next_page():
    first = CursorPaginator(page_size=10).paginate(ITEMS[0:10], total=25)
    assert first.next_cursor is not None
    pager = CursorPaginator(cursor=first.next_cursor, page_size=10)
    assert pager.offset == 10
    result = pager.paginate(ITEMS[10:20], total=25)
    assert [item.id for item in result.items] == list(range(10, 20))
    assert result.has_previous is True
    assert result.has_next is True
    assert decode_cursor(result.previous_cursor) == {"offset": 0}
    assert decode_cursor(result.next_cursor) == {"offset": 20}


def test_cursor_last_page_no_next():
    pager = CursorPaginator(cursor=encode_cursor({"offset": 20}), page_size=10)
    result = pager.paginate(ITEMS[20:25], total=25)
    assert result.has_next is False
    assert result.next_cursor is None
    assert result.has_previous is True


def test_cursor_empty_results():
    pager = CursorPaginator(page_size=10)
    result = pager.paginate([], total=0)
    assert result.items == []
    assert result.has_next is False
    assert result.has_previous is False
    assert result.next_cursor is None
    assert result.previous_cursor is None


def test_cursor_page_size_edge_cases():
    assert CursorPaginator(page_size=0).page_size == 50
    assert CursorPaginator(page_size=10_000).page_size == 100


def test_cursor_dependency_defaults_and_navigation():
    response = client.get("/items/cursor")
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["page_size"] == 50
    assert data["has_previous"] is False
    assert len(data["items"]) == 25

    paged = client.get("/items/cursor", params={"page_size": 10})
    paged_data = paged.json()
    assert paged_data["has_next"] is True
    next_cursor = paged_data["next_cursor"]
    assert next_cursor is not None

    follow = client.get(
        "/items/cursor", params={"cursor": next_cursor, "page_size": 10}
    )
    follow_data = follow.json()
    assert [item["id"] for item in follow_data["items"]] == list(range(10, 20))


def test_cursor_invalid_cursor_returns_400():
    response = client.get("/items/cursor", params={"cursor": "!!!bad!!!"})
    assert response.status_code == 400
    assert response.json() == {"detail": "Invalid pagination cursor"}
