from pydantic import BaseModel

from fastapi.pagination import PaginatedResponse, Paginator, paginate


class Item(BaseModel):
    id: int
    name: str


def test_offset_pagination_calculates_boundaries() -> None:
    paginator = Paginator(page=2, page_size=3)

    response = paginator.paginate_offset(list(range(10)))

    assert response.items == [3, 4, 5]
    assert response.total == 10
    assert response.page == 2
    assert response.page_size == 3
    assert response.total_pages == 4
    assert response.has_next is True
    assert response.has_previous is True


def test_offset_boundaries_for_first_last_and_empty_pages() -> None:
    assert Paginator(page=1, page_size=2).paginate_offset([1, 2]).has_previous is False
    assert Paginator(page=1, page_size=2).paginate_offset([1, 2]).has_next is False

    empty = Paginator(page=1, page_size=10).paginate_offset([])

    assert empty.items == []
    assert empty.total == 0
    assert empty.total_pages == 0
    assert empty.has_next is False
    assert empty.has_previous is False


def test_page_and_page_size_edge_cases_are_normalized() -> None:
    paginator = Paginator(page=0, page_size=0)

    assert paginator.page == 1
    assert paginator.page_size == Paginator.default_page_size
    assert paginator.offset == 0

    negative = Paginator(page=-2, page_size=-5)

    assert negative.page == 1
    assert negative.page_size == Paginator.default_page_size


def test_cursor_pagination_returns_navigation_cursors() -> None:
    first = Paginator(page_size=3).paginate_cursor(list(range(8)))

    assert first.items == [0, 1, 2]
    assert first.next_cursor is not None
    assert first.previous_cursor is None

    second = Paginator(page_size=3, cursor=first.next_cursor).paginate_cursor(list(range(8)))

    assert second.items == [3, 4, 5]
    assert second.has_next is True
    assert second.has_previous is True
    assert second.next_cursor is not None
    assert second.previous_cursor is not None

    last = Paginator(page_size=3, cursor=second.next_cursor).paginate_cursor(list(range(8)))

    assert last.items == [6, 7]
    assert last.has_next is False
    assert last.has_previous is True


def test_cursor_decoding_handles_invalid_values() -> None:
    response = Paginator(page_size=2, cursor="not-a-cursor").paginate_cursor([1, 2, 3])

    assert response.items == [1, 2]
    assert response.page == 1


def test_paginated_response_supports_pydantic_models() -> None:
    response: PaginatedResponse[Item] = Paginator(page=1, page_size=2).paginate_offset(
        [Item(id=1, name="one"), Item(id=2, name="two")]
    )

    assert response.items[0].name == "one"
    assert response.model_dump()["items"][1]["id"] == 2


def test_paginate_dependency_uses_query_defaults() -> None:
    paginator = paginate()

    assert isinstance(paginator, Paginator)
    assert paginator.page == 1
    assert paginator.page_size == 50
