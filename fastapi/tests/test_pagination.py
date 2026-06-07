import inspect

from pydantic import BaseModel

from fastapi.pagination import PaginatedResponse, Paginator, paginate


class Item(BaseModel):
    id: int
    name: str


class QueryStub:
    def __init__(self) -> None:
        self.calls: list[tuple[str, int]] = []

    def offset(self, value: int) -> "QueryStub":
        self.calls.append(("offset", value))
        return self

    def limit(self, value: int) -> "QueryStub":
        self.calls.append(("limit", value))
        return self


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


def test_previous_cursor_returns_to_prior_page() -> None:
    first = Paginator(page_size=3).paginate_cursor(list(range(8)))
    second = Paginator(page_size=3, cursor=first.next_cursor).paginate_cursor(list(range(8)))
    previous = Paginator(page_size=3, cursor=second.previous_cursor).paginate_cursor(list(range(8)))

    assert previous.items == first.items
    assert previous.page == first.page
    assert previous.has_previous is False


def test_cursor_beyond_total_returns_empty_last_window() -> None:
    cursor = Paginator.encode_cursor(99)
    response = Paginator(page_size=3, cursor=cursor).paginate_cursor(list(range(8)))

    assert response.items == []
    assert response.has_next is False
    assert response.has_previous is True


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


def test_paginate_dependency_reads_values_and_keeps_plain_defaults() -> None:
    signature = inspect.signature(paginate)
    assert signature.parameters["page"].default == 1
    assert signature.parameters["page_size"].default == 50
    assert signature.parameters["cursor"].default is None

    paginator = paginate(page=3, page_size=7, cursor="abc")

    assert paginator.page == 3
    assert paginator.page_size == 7
    assert paginator.offset == 14
    assert paginator.limit == 7
    assert paginator.cursor == "abc"


def test_apply_offset_supports_sqlalchemy_style_queries() -> None:
    query = QueryStub()

    returned = Paginator(page=4, page_size=25).apply_offset(query)

    assert returned is query
    assert query.calls == [("offset", 75), ("limit", 25)]
