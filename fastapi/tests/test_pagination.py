from typing import Annotated

from fastapi import Depends, FastAPI
from fastapi.pagination import PaginatedResponse, PaginationParams, Paginator, paginate
from fastapi.testclient import TestClient
from pydantic import BaseModel


class Item(BaseModel):
    name: str


class FakeQuery:
    def __init__(self, items: list[int]):
        self.items = items
        self.offset_value = 0
        self.limit_value = len(items)

    def count(self) -> int:
        return len(self.items)

    def offset(self, value: int) -> "FakeQuery":
        query = FakeQuery(self.items)
        query.offset_value = value
        query.limit_value = self.limit_value
        return query

    def limit(self, value: int) -> "FakeQuery":
        query = FakeQuery(self.items)
        query.offset_value = self.offset_value
        query.limit_value = value
        return query

    def all(self) -> list[int]:
        return self.items[self.offset_value : self.offset_value + self.limit_value]


def test_offset_pagination_calculates_metadata_and_items():
    result = Paginator(page=2, page_size=3).paginate(list(range(10)))

    assert result.items == [3, 4, 5]
    assert result.total == 10
    assert result.page == 2
    assert result.page_size == 3
    assert result.total_pages == 4
    assert result.has_next is True
    assert result.has_previous is True


def test_offset_pagination_handles_boundaries_and_empty_results():
    first_page = Paginator(page=1, page_size=3).paginate([1, 2, 3])
    empty = Paginator(page=0, page_size=0).paginate([])

    assert first_page.has_next is False
    assert first_page.has_previous is False
    assert empty.items == []
    assert empty.page == 1
    assert empty.page_size == 50
    assert empty.total_pages == 0
    assert empty.has_next is False
    assert empty.has_previous is False


def test_sqlalchemy_style_query_is_supported():
    result = Paginator(page=3, page_size=2).paginate(FakeQuery([10, 20, 30, 40, 50]))

    assert result.items == [50]
    assert result.total == 5
    assert result.total_pages == 3
    assert result.has_next is False
    assert result.has_previous is True


def test_cursor_pagination_uses_encoded_next_and_previous_cursors():
    paginator = Paginator(page_size=2)
    first = paginator.paginate_cursor(["a", "b", "c", "d", "e"])
    second = paginator.paginate_cursor(
        ["a", "b", "c", "d", "e"], cursor=first.next_cursor
    )

    assert first.items == ["a", "b"]
    assert first.next_cursor is not None
    assert first.previous_cursor is None
    assert second.items == ["c", "d"]
    assert second.has_next is True
    assert second.has_previous is True
    assert second.previous_cursor == Paginator.encode_cursor(0)


def test_cursor_pagination_handles_invalid_cursor_and_last_page():
    paginator = Paginator(page_size=2)
    invalid = paginator.paginate_cursor([1, 2, 3], cursor="not-a-cursor")
    last = paginator.paginate_cursor([1, 2, 3], cursor=invalid.next_cursor)

    assert invalid.items == [1, 2]
    assert last.items == [3]
    assert last.has_next is False
    assert last.has_previous is True


def test_paginated_response_generic_accepts_pydantic_models():
    result = PaginatedResponse[Item](
        items=[Item(name="alpha")],
        total=1,
        page=1,
        page_size=50,
        total_pages=1,
        has_next=False,
        has_previous=False,
    )

    assert result.model_dump() == {
        "items": [{"name": "alpha"}],
        "total": 1,
        "page": 1,
        "page_size": 50,
        "total_pages": 1,
        "has_next": False,
        "has_previous": False,
        "next_cursor": None,
        "previous_cursor": None,
    }


def test_paginate_dependency_reads_and_normalizes_query_parameters():
    app = FastAPI()

    @app.get("/items/")
    def read_items(params: Annotated[PaginationParams, Depends(paginate)]):
        return params.model_dump()

    client = TestClient(app)

    response = client.get("/items/?page=-2&page_size=0")
    custom = client.get("/items/?page=3&page_size=5")

    assert response.status_code == 200, response.text
    assert response.json() == {"page": 1, "page_size": 50, "cursor": None}
    assert custom.json() == {"page": 3, "page_size": 5, "cursor": None}
