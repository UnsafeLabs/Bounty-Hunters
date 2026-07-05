from typing import Annotated

from fastapi import Depends, FastAPI
from fastapi.pagination import PaginatedResponse, Paginator, paginate
from fastapi.testclient import TestClient
from pydantic import BaseModel


class Item(BaseModel):
    id: int
    name: str


ITEMS = [Item(id=index, name=f"item-{index}") for index in range(1, 26)]


class FakeQuery:
    def __init__(self):
        self.offset_value = None
        self.limit_value = None

    def offset(self, value):
        self.offset_value = value
        return self

    def limit(self, value):
        self.limit_value = value
        return self


def test_offset_pagination_calculates_skip_limit_and_boundaries():
    paginator = Paginator(page=2, page_size=10)
    response = paginator.paginate_sequence(ITEMS)

    assert paginator.offset == 10
    assert paginator.limit == 10
    assert [item.id for item in response.items] == list(range(11, 21))
    assert response.total == 25
    assert response.page == 2
    assert response.page_size == 10
    assert response.total_pages == 3
    assert response.has_next is True
    assert response.has_previous is True


def test_offset_pagination_sets_boundary_flags_on_first_and_last_pages():
    first = Paginator(page=1, page_size=10).paginate_sequence(ITEMS)
    last = Paginator(page=3, page_size=10).paginate_sequence(ITEMS)

    assert [item.id for item in first.items] == list(range(1, 11))
    assert first.has_previous is False
    assert first.has_next is True
    assert [item.id for item in last.items] == list(range(21, 26))
    assert last.has_previous is True
    assert last.has_next is False


def test_offset_pagination_handles_invalid_page_and_page_size_values():
    paginator = Paginator(page=-5, page_size=0)
    response = paginator.paginate_sequence(ITEMS)

    assert paginator.page == 1
    assert paginator.page_size == 50
    assert [item.id for item in response.items] == list(range(1, 26))
    assert response.total_pages == 1
    assert response.has_next is False
    assert response.has_previous is False


def test_offset_pagination_can_be_applied_to_sqlalchemy_style_queries():
    query = FakeQuery()

    result = Paginator(page=4, page_size=15).apply_to_query(query)

    assert result is query
    assert query.offset_value == 45
    assert query.limit_value == 15


def test_empty_results_return_zero_total_pages():
    response = Paginator(page=1, page_size=10).paginate_sequence([])

    assert response.items == []
    assert response.total == 0
    assert response.page == 1
    assert response.total_pages == 0
    assert response.has_next is False
    assert response.has_previous is False


def test_cursor_pagination_uses_encoded_cursors_for_navigation():
    first = Paginator(page_size=7).paginate_cursor_sequence(ITEMS)
    assert [item.id for item in first.items] == list(range(1, 8))
    assert first.previous_cursor is None
    assert first.next_cursor is not None

    second = Paginator(page_size=7, cursor=first.next_cursor).paginate_cursor_sequence(
        ITEMS
    )
    assert [item.id for item in second.items] == list(range(8, 15))
    assert second.page == 2
    assert second.previous_cursor is not None
    assert second.next_cursor is not None

    previous = Paginator(
        page_size=7, cursor=second.previous_cursor
    ).paginate_cursor_sequence(ITEMS)
    assert [item.id for item in previous.items] == list(range(1, 8))


def test_invalid_cursor_falls_back_to_first_page():
    response = Paginator(
        page_size=5, cursor="not-a-valid-cursor"
    ).paginate_cursor_sequence(ITEMS)

    assert [item.id for item in response.items] == list(range(1, 6))
    assert response.page == 1
    assert response.has_previous is False
    assert response.has_next is True


def test_paginated_response_generic_validates_item_type():
    response = PaginatedResponse[Item](
        items=[{"id": 1, "name": "parsed"}],
        total=1,
        page=1,
        page_size=10,
        total_pages=1,
        has_next=False,
        has_previous=False,
    )

    assert response.items == [Item(id=1, name="parsed")]


def test_paginate_dependency_reads_query_parameters():
    app = FastAPI()

    @app.get("/items", response_model=PaginatedResponse[Item])
    def read_items(paginator: Annotated[Paginator, Depends(paginate)]):
        return paginator.paginate_sequence(ITEMS)

    client = TestClient(app)
    response = client.get("/items?page=2&page_size=4")

    assert response.status_code == 200
    assert response.json() == {
        "items": [
            {"id": 5, "name": "item-5"},
            {"id": 6, "name": "item-6"},
            {"id": 7, "name": "item-7"},
            {"id": 8, "name": "item-8"},
        ],
        "total": 25,
        "page": 2,
        "page_size": 4,
        "total_pages": 7,
        "has_next": True,
        "has_previous": True,
        "next_cursor": None,
        "previous_cursor": None,
    }


def test_paginate_dependency_supports_cursor_parameter():
    app = FastAPI()

    @app.get("/items")
    def read_items(paginator: Annotated[Paginator, Depends(paginate)]):
        return paginator.paginate_cursor_sequence(ITEMS)

    client = TestClient(app)
    first = client.get("/items?page_size=6").json()
    second = client.get(f"/items?page_size=6&cursor={first['next_cursor']}").json()

    assert [item["id"] for item in first["items"]] == list(range(1, 7))
    assert [item["id"] for item in second["items"]] == list(range(7, 13))
    assert second["page"] == 2
    assert second["has_previous"] is True
