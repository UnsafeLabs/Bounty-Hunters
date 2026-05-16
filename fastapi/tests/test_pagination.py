"""Tests for pagination module."""
from fastapi.pagination import (
    CursorPage,
    PaginatedResponse,
    cursor_paginated_response,
    paginated_response,
)


class FakeItem:
    def __init__(self, id: int, name: str):
        self.id = id
        self.name = name


def test_paginated_response_basic():
    result = paginated_response(items=[1, 2, 3], total=30, page=1, page_size=3)
    assert isinstance(result, PaginatedResponse)
    assert result.items == [1, 2, 3]
    assert result.total == 30
    assert result.page == 1
    assert result.page_size == 3
    assert result.total_pages == 10
    assert result.has_next is True
    assert result.has_previous is False


def test_paginated_response_last_page():
    result = paginated_response(items=[1], total=10, page=10, page_size=1)
    assert result.has_next is False
    assert result.has_previous is True


def test_paginated_response_middle_page():
    result = paginated_response(items=[1, 2], total=10, page=2, page_size=2)
    assert result.has_next is True
    assert result.has_previous is True


def test_paginated_response_empty():
    result = paginated_response(items=[], total=0, page=1, page_size=20)
    assert result.total_pages == 1
    assert result.has_next is False
    assert result.has_previous is False


def test_paginated_response_single_page():
    result = paginated_response(items=[1, 2, 3], total=3, page=1, page_size=10)
    assert result.total_pages == 1
    assert result.has_next is False


def test_cursor_paginated_response_with_objects():
    items = [FakeItem(1, "a"), FakeItem(2, "b"), FakeItem(3, "c")]
    result = cursor_paginated_response(items, has_more=True, page_size=2)
    assert isinstance(result, CursorPage)
    assert len(result.items) == 2
    assert result.has_next is True
    assert result.next_cursor is not None


def test_cursor_paginated_response_no_more():
    items = [FakeItem(1, "a")]
    result = cursor_paginated_response(items, has_more=False, page_size=10)
    assert result.has_next is False
    assert result.next_cursor is None
