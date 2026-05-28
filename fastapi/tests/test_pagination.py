from fastapi.pagination import PaginatedResponse, Paginator, paginate
from pydantic import BaseModel


class Item(BaseModel):
    id: int
    name: str


def make_items(count: int = 10) -> list[Item]:
    return [Item(id=index, name=f"item-{index}") for index in range(1, count + 1)]


def test_offset_pagination_calculates_boundaries() -> None:
    paginator = Paginator(page=2, page_size=3)
    response = paginator.paginate_offset(make_items(8))

    assert paginator.offset == 3
    assert paginator.limit == 3
    assert [item.id for item in response.items] == [4, 5, 6]
    assert response.total == 8
    assert response.page == 2
    assert response.page_size == 3
    assert response.total_pages == 3
    assert response.has_next is True
    assert response.has_previous is True


def test_offset_pagination_handles_empty_and_invalid_inputs() -> None:
    paginator = Paginator(page=0, page_size=0)
    response = paginator.paginate_offset([])

    assert paginator.page == 1
    assert paginator.page_size == 1
    assert response.items == []
    assert response.total == 0
    assert response.total_pages == 0
    assert response.has_next is False
    assert response.has_previous is False

    negative = Paginator(page=-10, page_size=-5)
    assert negative.page == 1
    assert negative.page_size == 1


def test_offset_pagination_supports_presliced_sqlalchemy_results() -> None:
    paginator = Paginator(page=3, page_size=2)
    response = paginator.paginate_offset(make_items(2), total=10, already_sliced=True)

    assert [item.id for item in response.items] == [1, 2]
    assert response.total == 10
    assert response.total_pages == 5
    assert response.has_next is True
    assert response.has_previous is True


def test_cursor_pagination_uses_encoded_cursor_navigation() -> None:
    paginator = Paginator(page_size=3)
    items = make_items(8)

    first_page = paginator.paginate_cursor(items, cursor_getter=lambda item: item.id)
    assert [item.id for item in first_page.items] == [1, 2, 3]
    assert first_page.next_cursor == Paginator.encode_cursor(3)
    assert first_page.previous_cursor is None
    assert first_page.has_next is True
    assert first_page.has_previous is False

    second_page = paginator.paginate_cursor(
        items,
        first_page.next_cursor,
        cursor_getter=lambda item: item.id,
    )
    assert [item.id for item in second_page.items] == [4, 5, 6]
    assert second_page.next_cursor == Paginator.encode_cursor(6)
    assert second_page.previous_cursor is None
    assert second_page.has_next is True
    assert second_page.has_previous is True

    third_page = paginator.paginate_cursor(
        items,
        second_page.next_cursor,
        cursor_getter=lambda item: item.id,
    )
    assert [item.id for item in third_page.items] == [7, 8]
    assert third_page.next_cursor is None
    assert third_page.previous_cursor == Paginator.encode_cursor(3)
    assert third_page.has_next is False
    assert third_page.has_previous is True


def test_cursor_pagination_rejects_unknown_cursor() -> None:
    paginator = Paginator(page_size=3)
    unknown_cursor = Paginator.encode_cursor("missing")

    try:
        paginator.paginate_cursor(make_items(), unknown_cursor, cursor_getter=lambda item: item.id)
    except ValueError as error:
        assert str(error) == "Cursor not found"
    else:
        raise AssertionError("Expected unknown cursor to fail")


def test_paginated_response_is_generic_over_pydantic_models() -> None:
    response = PaginatedResponse[Item](
        items=[{"id": 1, "name": "item-1"}],
        total=1,
        page=1,
        page_size=20,
        total_pages=1,
        has_next=False,
        has_previous=False,
    )

    assert isinstance(response.items[0], Item)
    assert response.items[0].name == "item-1"


def test_paginate_dependency_returns_paginator_with_defaults_and_query_values() -> None:
    default_paginator = paginate()
    custom_paginator = paginate(page=4, page_size=50)

    assert default_paginator.page == 1
    assert default_paginator.page_size == 20
    assert custom_paginator.page == 4
    assert custom_paginator.page_size == 50
