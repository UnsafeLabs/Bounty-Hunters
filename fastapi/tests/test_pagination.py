from typing import Annotated

import pytest
from fastapi import Depends, FastAPI
from fastapi.pagination import (
    PaginatedResponse,
    PaginationParams,
    Paginator,
    decode_cursor,
    encode_cursor,
    paginate,
)
from fastapi.testclient import TestClient
from pydantic import BaseModel


class Item(BaseModel):
    name: str


ITEMS = [Item(name=f"item-{number}") for number in range(1, 11)]


def test_offset_pagination_calculates_page_boundaries() -> None:
    response = Paginator[Item](page=2, page_size=3).paginate(ITEMS)

    assert [item.name for item in response.items] == ["item-4", "item-5", "item-6"]
    assert response.total == 10
    assert response.page == 2
    assert response.page_size == 3
    assert response.total_pages == 4
    assert response.has_next is True
    assert response.has_previous is True


def test_offset_pagination_handles_empty_and_invalid_inputs() -> None:
    response = Paginator[Item](page=0, page_size=0).paginate([])

    assert response.items == []
    assert response.total == 0
    assert response.page == 1
    assert response.page_size == 20
    assert response.total_pages == 0
    assert response.has_next is False
    assert response.has_previous is False


def test_offset_pagination_can_wrap_already_sliced_query_results() -> None:
    response = Paginator[Item](page=3, page_size=2).paginate(
        ITEMS[4:6],
        total=len(ITEMS),
        already_sliced=True,
    )

    assert [item.name for item in response.items] == ["item-5", "item-6"]
    assert response.total_pages == 5
    assert response.has_next is True
    assert response.has_previous is True


def test_apply_to_query_uses_sqlalchemy_style_offset_and_limit() -> None:
    class QuerySpy:
        def __init__(self) -> None:
            self.calls: list[tuple[str, int]] = []

        def offset(self, value: int) -> "QuerySpy":
            self.calls.append(("offset", value))
            return self

        def limit(self, value: int) -> "QuerySpy":
            self.calls.append(("limit", value))
            return self

    query = QuerySpy()
    result = Paginator[Item](page=3, page_size=25).apply_to_query(query)

    assert result is query
    assert query.calls == [("offset", 50), ("limit", 25)]


def test_cursor_pagination_returns_navigation_cursors() -> None:
    first_page = Paginator[Item](page_size=4).paginate_cursor(ITEMS)

    assert [item.name for item in first_page.items] == [
        "item-1",
        "item-2",
        "item-3",
        "item-4",
    ]
    assert first_page.has_next is True
    assert first_page.has_previous is False
    assert first_page.next_cursor is not None
    assert first_page.previous_cursor is None

    second_page = Paginator[Item](
        page_size=4,
        cursor=first_page.next_cursor,
    ).paginate_cursor(ITEMS)

    assert [item.name for item in second_page.items] == [
        "item-5",
        "item-6",
        "item-7",
        "item-8",
    ]
    assert second_page.has_next is True
    assert second_page.has_previous is True
    assert second_page.previous_cursor == encode_cursor(0)


def test_cursor_pagination_handles_out_of_range_cursor() -> None:
    response = Paginator[Item](
        page_size=3,
        cursor=encode_cursor(999),
    ).paginate_cursor(ITEMS)

    assert response.items == []
    assert response.page == 4
    assert response.has_next is False
    assert response.has_previous is True


def test_cursor_helpers_validate_payloads() -> None:
    assert decode_cursor(encode_cursor(6)) == 6

    with pytest.raises(ValueError, match="Invalid pagination cursor"):
        decode_cursor("not-a-cursor")


def test_paginated_response_is_generic_over_pydantic_models() -> None:
    response = PaginatedResponse[Item](
        items=[Item(name="item-1")],
        total=1,
        page=1,
        page_size=20,
        total_pages=1,
        has_next=False,
        has_previous=False,
    )

    assert response.model_dump()["items"] == [{"name": "item-1"}]


def test_paginate_dependency_reads_query_parameters() -> None:
    app = FastAPI()

    @app.get("/items")
    def read_items(
        params: Annotated[PaginationParams, Depends(paginate)],
    ) -> PaginatedResponse[Item]:
        return params.to_paginator().paginate(ITEMS)

    client = TestClient(app)
    response = client.get("/items?page=2&page_size=4")

    assert response.status_code == 200
    assert response.json() == {
        "items": [
            {"name": "item-5"},
            {"name": "item-6"},
            {"name": "item-7"},
            {"name": "item-8"},
        ],
        "total": 10,
        "page": 2,
        "page_size": 4,
        "total_pages": 3,
        "has_next": True,
        "has_previous": True,
        "next_cursor": None,
        "previous_cursor": None,
    }


def test_paginate_dependency_normalizes_edge_case_query_parameters() -> None:
    app = FastAPI()

    @app.get("/items")
    def read_items(
        params: Annotated[PaginationParams, Depends(paginate)],
    ) -> PaginatedResponse[Item]:
        return params.to_paginator().paginate(ITEMS)

    client = TestClient(app)
    response = client.get("/items?page=0&page_size=0")

    assert response.status_code == 200
    assert response.json()["page"] == 1
    assert response.json()["page_size"] == 20
    assert response.json()["items"] == [{"name": item.name} for item in ITEMS]


def test_paginate_dependency_uses_sensible_defaults_directly() -> None:
    params = paginate()

    assert params.page == 1
    assert params.page_size == 20
    assert params.cursor is None
