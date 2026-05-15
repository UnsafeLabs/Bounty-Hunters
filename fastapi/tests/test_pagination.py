from typing import Annotated

from fastapi import Depends, FastAPI
from fastapi.pagination import PaginatedResponse, Paginator, paginate
from fastapi.testclient import TestClient
from pydantic import BaseModel


class Item(BaseModel):
    id: int
    name: str


ITEMS = [Item(id=index, name=f"item-{index}") for index in range(1, 8)]


def test_offset_pagination_calculates_metadata_and_items():
    paginator = Paginator(page=2, page_size=3)

    response = paginator.paginate_sequence(ITEMS)

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


def test_offset_pagination_boundaries():
    first_page = Paginator(page=1, page_size=3).paginate_sequence(ITEMS)
    last_page = Paginator(page=3, page_size=3).paginate_sequence(ITEMS)

    assert first_page.has_previous is False
    assert first_page.has_next is True
    assert last_page.has_previous is True
    assert last_page.has_next is False
    assert last_page.items == [ITEMS[-1]]


def test_cursor_pagination_returns_encoded_navigation_cursors():
    first_page = Paginator(page_size=3).paginate_sequence(ITEMS, cursor=True)

    assert first_page.next_cursor is not None
    assert first_page.previous_cursor is None

    second_page = Paginator(
        page_size=3, cursor=first_page.next_cursor
    ).paginate_sequence(ITEMS, cursor=True)

    assert [item.id for item in second_page.items] == [4, 5, 6]
    assert second_page.page == 2
    assert second_page.has_next is True
    assert second_page.has_previous is True
    assert second_page.next_cursor is not None
    assert second_page.previous_cursor == Paginator.encode_cursor(0)

    third_page = Paginator(
        page_size=3, cursor=second_page.next_cursor
    ).paginate_sequence(ITEMS, cursor=True)

    assert [item.id for item in third_page.items] == [7]
    assert third_page.page == 3
    assert third_page.has_next is False
    assert third_page.has_previous is True
    assert third_page.next_cursor is None
    assert third_page.previous_cursor == Paginator.encode_cursor(3)


def test_invalid_page_and_page_size_use_sensible_defaults():
    response = Paginator(page=-2, page_size=0).paginate_sequence(ITEMS)

    assert response.page == 1
    assert response.page_size == 20
    assert response.total_pages == 1
    assert response.has_next is False
    assert response.has_previous is False
    assert response.items == ITEMS


def test_empty_results_are_paginated_without_navigation():
    response = Paginator(page=0, page_size=3).paginate_sequence([])

    assert response.model_dump() == {
        "items": [],
        "total": 0,
        "page": 1,
        "page_size": 3,
        "total_pages": 0,
        "has_next": False,
        "has_previous": False,
        "next_cursor": None,
        "previous_cursor": None,
    }


def test_paginate_dependency_reads_query_parameters():
    app = FastAPI()

    @app.get("/items", response_model=PaginatedResponse[Item])
    def read_items(paginator: Annotated[Paginator, Depends(paginate)]):
        return paginator.paginate_sequence(ITEMS)

    client = TestClient(app)

    response = client.get("/items?page=2&page_size=2")

    assert response.status_code == 200
    assert response.json() == {
        "items": [
            {"id": 3, "name": "item-3"},
            {"id": 4, "name": "item-4"},
        ],
        "total": 7,
        "page": 2,
        "page_size": 2,
        "total_pages": 4,
        "has_next": True,
        "has_previous": True,
        "next_cursor": None,
        "previous_cursor": None,
    }


def test_paginated_response_is_generic_over_pydantic_models():
    response = PaginatedResponse[Item](
        items=[Item(id=1, name="item-1")],
        total=1,
        page=1,
        page_size=20,
        total_pages=1,
        has_next=False,
        has_previous=False,
    )

    assert response.model_dump()["items"] == [{"id": 1, "name": "item-1"}]


def test_apply_to_query_uses_offset_and_limit():
    class Query:
        def __init__(self) -> None:
            self.calls: list[tuple[str, int]] = []

        def offset(self, value: int) -> "Query":
            self.calls.append(("offset", value))
            return self

        def limit(self, value: int) -> "Query":
            self.calls.append(("limit", value))
            return self

    query = Query()

    assert Paginator(page=3, page_size=10).apply_to_query(query) is query
    assert query.calls == [("offset", 20), ("limit", 10)]


def test_paginate_query_supports_sqlalchemy_style_query_objects():
    class Query:
        def __init__(self, items: list[Item]) -> None:
            self.items = items
            self.start = 0
            self.stop = len(items)

        def count(self) -> int:
            return len(self.items)

        def offset(self, value: int) -> "Query":
            self.start = value
            return self

        def limit(self, value: int) -> "Query":
            self.stop = self.start + value
            return self

        def all(self) -> list[Item]:
            return self.items[self.start : self.stop]

    response = Paginator(page=2, page_size=2).paginate_query(Query(ITEMS))

    assert [item.id for item in response.items] == [3, 4]
    assert response.total == 7
    assert response.total_pages == 4
