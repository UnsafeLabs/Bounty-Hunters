from typing import Annotated

from fastapi import Depends, FastAPI
from fastapi.pagination import PaginatedResponse, Paginator, paginate
from fastapi.testclient import TestClient
from pydantic import BaseModel


class Item(BaseModel):
    id: int
    name: str


def test_offset_pagination_calculates_boundaries():
    items = [Item(id=index, name=f"item-{index}") for index in range(1, 8)]
    paginator = Paginator(page=2, page_size=3)

    response = paginator.paginate_sequence(items)

    assert paginator.offset == 3
    assert paginator.skip == 3
    assert paginator.limit == 3
    assert response.model_dump() == {
        "items": [
            {"id": 4, "name": "item-4"},
            {"id": 5, "name": "item-5"},
            {"id": 6, "name": "item-6"},
        ],
        "total": 7,
        "page": 2,
        "page_size": 3,
        "total_pages": 3,
        "has_next": True,
        "has_previous": True,
        "next_cursor": None,
        "previous_cursor": None,
    }


def test_invalid_page_inputs_are_clamped_and_empty_results_work():
    paginator = Paginator(page=-5, page_size=0)
    response = paginator.paginate_sequence([])

    assert paginator.page == 1
    assert paginator.page_size == 1
    assert response.model_dump() == {
        "items": [],
        "total": 0,
        "page": 1,
        "page_size": 1,
        "total_pages": 0,
        "has_next": False,
        "has_previous": False,
        "next_cursor": None,
        "previous_cursor": None,
    }


def test_paginator_applies_sqlalchemy_style_offset_and_limit():
    class Query:
        def __init__(self) -> None:
            self.offset_value = None
            self.limit_value = None

        def offset(self, value: int):
            self.offset_value = value
            return self

        def limit(self, value: int):
            self.limit_value = value
            return self

    query = Query()
    returned = Paginator(page=3, page_size=25).apply(query)

    assert returned is query
    assert query.offset_value == 50
    assert query.limit_value == 25


def test_cursor_pagination_uses_encoded_next_and_previous_cursors():
    items = [Item(id=index, name=f"item-{index}") for index in range(1, 6)]
    paginator = Paginator(page_size=2)

    first_page = paginator.paginate_cursor(items, cursor_key="id")
    second_page = paginator.paginate_cursor(
        items, after=first_page.next_cursor, cursor_key="id"
    )
    previous_page = paginator.paginate_cursor(
        items, before=second_page.previous_cursor, cursor_key="id"
    )

    assert [item.id for item in first_page.items] == [1, 2]
    assert first_page.next_cursor is not None
    assert first_page.next_cursor != "2"
    assert first_page.previous_cursor is None
    assert first_page.has_next is True
    assert first_page.has_previous is False

    assert [item.id for item in second_page.items] == [3, 4]
    assert second_page.page == 2
    assert second_page.next_cursor is not None
    assert second_page.previous_cursor is not None
    assert second_page.has_next is True
    assert second_page.has_previous is True

    assert [item.id for item in previous_page.items] == [1, 2]


def test_paginated_response_wraps_pydantic_models():
    page = PaginatedResponse[Item](
        items=[Item(id=1, name="portal")],
        total=1,
        page=1,
        page_size=10,
        total_pages=1,
        has_next=False,
        has_previous=False,
    )

    assert page.model_dump()["items"] == [{"id": 1, "name": "portal"}]


def test_paginate_dependency_reads_query_parameters():
    app = FastAPI()
    items = [Item(id=index, name=f"item-{index}") for index in range(1, 5)]

    @app.get("/items", response_model=PaginatedResponse[Item])
    def list_items(
        paginator: Annotated[Paginator, Depends(paginate)],
    ) -> PaginatedResponse[Item]:
        return paginator.paginate_sequence(items)

    client = TestClient(app)

    response = client.get("/items?page=2&page_size=2")
    assert response.status_code == 200
    assert response.json() == {
        "items": [{"id": 3, "name": "item-3"}, {"id": 4, "name": "item-4"}],
        "total": 4,
        "page": 2,
        "page_size": 2,
        "total_pages": 2,
        "has_next": False,
        "has_previous": True,
        "next_cursor": None,
        "previous_cursor": None,
    }

    response = client.get("/items?page=0&page_size=0")
    assert response.status_code == 200
    assert response.json()["page"] == 1
    assert response.json()["page_size"] == 1
