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
    id: int
    name: str


ITEMS = [Item(id=number, name=f"item-{number}") for number in range(1, 11)]


def test_offset_pagination_calculates_skip_limit_and_boundaries() -> None:
    paginator = Paginator[Item](page=2, page_size=3)
    response = paginator.paginate(ITEMS)

    assert paginator.offset == 3
    assert paginator.skip == 3
    assert paginator.limit == 3
    assert [item.id for item in response.items] == [4, 5, 6]
    assert response.total == 10
    assert response.page == 2
    assert response.page_size == 3
    assert response.total_pages == 4
    assert response.has_next is True
    assert response.has_previous is True


def test_offset_pagination_handles_first_last_and_empty_boundaries() -> None:
    first_page = Paginator[Item](page=1, page_size=5).paginate(ITEMS)
    last_page = Paginator[Item](page=2, page_size=5).paginate(ITEMS)
    empty_page = Paginator[Item](page=1, page_size=5).paginate([])

    assert first_page.has_next is True
    assert first_page.has_previous is False
    assert last_page.has_next is False
    assert last_page.has_previous is True
    assert empty_page.items == []
    assert empty_page.total == 0
    assert empty_page.total_pages == 0
    assert empty_page.has_next is False
    assert empty_page.has_previous is False


def test_edge_case_page_and_page_size_values_are_normalized() -> None:
    negative_page = Paginator[Item](page=-5, page_size=2).paginate(ITEMS)
    zero_page = Paginator[Item](page=0, page_size=2).paginate(ITEMS)
    zero_size = Paginator[Item](page=1, page_size=0).paginate(ITEMS)
    capped_size = Paginator[Item](page=1, page_size=500, max_page_size=30).paginate(ITEMS)

    assert negative_page.page == 1
    assert zero_page.page == 1
    assert zero_size.page_size == 20
    assert capped_size.page_size == 30


def test_already_sliced_results_can_be_wrapped_with_total_metadata() -> None:
    response = Paginator[Item](page=3, page_size=2).paginate(
        ITEMS[4:6],
        total=len(ITEMS),
        already_sliced=True,
    )

    assert [item.id for item in response.items] == [5, 6]
    assert response.total == 10
    assert response.total_pages == 5
    assert response.has_next is True
    assert response.has_previous is True


def test_sqlalchemy_style_queries_receive_offset_and_limit() -> None:
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
    returned = Paginator[Item](page=4, page_size=25).apply_to_query(query)

    assert returned is query
    assert query.calls == [("offset", 75), ("limit", 25)]


def test_offset_cursor_pagination_returns_encoded_next_and_previous_cursors() -> None:
    first_page = Paginator[Item](page_size=4).paginate_cursor(ITEMS)

    assert [item.id for item in first_page.items] == [1, 2, 3, 4]
    assert first_page.page == 1
    assert first_page.has_next is True
    assert first_page.has_previous is False
    assert first_page.next_cursor is not None
    assert first_page.previous_cursor is None
    assert decode_cursor(first_page.next_cursor) == 4

    second_page = Paginator[Item](
        page_size=4,
        cursor=first_page.next_cursor,
    ).paginate_cursor(ITEMS)

    assert [item.id for item in second_page.items] == [5, 6, 7, 8]
    assert second_page.page == 2
    assert second_page.has_next is True
    assert second_page.has_previous is True
    assert second_page.previous_cursor == encode_cursor(0)


def test_offset_cursor_pagination_handles_out_of_range_and_invalid_cursors() -> None:
    response = Paginator[Item](
        page_size=3,
        cursor=encode_cursor(999),
    ).paginate_cursor(ITEMS)

    assert response.items == []
    assert response.page == 4
    assert response.has_next is False
    assert response.has_previous is True

    with pytest.raises(ValueError, match="Invalid pagination cursor"):
        Paginator[Item](cursor="not-a-cursor").paginate_cursor(ITEMS)


def test_key_cursor_pagination_can_move_forward_and_backward() -> None:
    first_page = Paginator[Item](page_size=3).paginate_cursor(
        ITEMS,
        cursor_key="id",
    )
    second_page = Paginator[Item](page_size=3).paginate_cursor(
        ITEMS,
        after=first_page.next_cursor,
        cursor_key="id",
    )
    previous_page = Paginator[Item](page_size=3).paginate_cursor(
        ITEMS,
        before=second_page.previous_cursor,
        cursor_key="id",
    )

    assert [item.id for item in first_page.items] == [1, 2, 3]
    assert first_page.next_cursor is not None
    assert first_page.next_cursor != "3"
    assert first_page.previous_cursor is None
    assert [item.id for item in second_page.items] == [4, 5, 6]
    assert second_page.has_next is True
    assert second_page.has_previous is True
    assert [item.id for item in previous_page.items] == [1, 2, 3]


def test_cursor_helpers_validate_payloads() -> None:
    assert decode_cursor(encode_cursor(6)) == 6

    with pytest.raises(ValueError, match="Invalid pagination cursor"):
        decode_cursor("not-a-cursor")


def test_paginated_response_is_generic_over_pydantic_models() -> None:
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


def test_paginate_dependency_reads_query_parameters_and_normalizes_edges() -> None:
    app = FastAPI()

    @app.get("/items", response_model=PaginatedResponse[Item])
    def read_items(
        paginator: Annotated[Paginator[Item], Depends(paginate)],
    ) -> PaginatedResponse[Item]:
        return paginator.paginate(ITEMS)

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
        "total": 10,
        "page": 2,
        "page_size": 4,
        "total_pages": 3,
        "has_next": True,
        "has_previous": True,
        "next_cursor": None,
        "previous_cursor": None,
    }

    edge_response = client.get("/items?page=0&page_size=0")

    assert edge_response.status_code == 200
    assert edge_response.json()["page"] == 1
    assert edge_response.json()["page_size"] == 20


def test_paginate_dependency_can_pass_cursor_query_parameter() -> None:
    app = FastAPI()

    @app.get("/items", response_model=PaginatedResponse[Item])
    def read_items(
        paginator: Annotated[Paginator[Item], Depends(paginate)],
    ) -> PaginatedResponse[Item]:
        return paginator.paginate_cursor(ITEMS)

    client = TestClient(app)
    response = client.get(f"/items?page_size=3&cursor={encode_cursor(3)}")

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == [4, 5, 6]
    assert response.json()["has_next"] is True
    assert response.json()["has_previous"] is True


def test_pagination_params_can_create_paginator() -> None:
    params = PaginationParams(page=2, page_size=2, cursor=encode_cursor(4))
    paginator = params.to_paginator()

    assert paginator.page == 2
    assert paginator.page_size == 2
    assert paginator.cursor == encode_cursor(4)
