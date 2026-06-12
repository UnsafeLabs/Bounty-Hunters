"""Tests for pagination utilities."""

from __future__ import annotations

import math
from dataclasses import dataclass

import pytest

from fastapi.pagination import (
    CursorPaginatedResponse,
    CursorParams,
    PaginatedResponse,
    PaginationParams,
    Paginator,
    cursor_paginate,
    paginate,
)


# --- PaginationParams tests ---

class TestPaginationParams:
    def test_defaults(self):
        p = PaginationParams()
        assert p.page == 1
        assert p.page_size == 20
        assert p.offset == 0
        assert p.limit == 20

    def test_custom_values(self):
        p = PaginationParams(page=3, page_size=10)
        assert p.offset == 20
        assert p.limit == 10

    def test_page_zero(self):
        p = PaginationParams(page=0, page_size=10)
        assert p.offset == 0

    def test_negative_page(self):
        p = PaginationParams(page=-1, page_size=10)
        assert p.offset == 0

    def test_page_size_zero(self):
        p = PaginationParams(page=1, page_size=0)
        assert p.limit == 0


# --- CursorParams tests ---

class TestCursorParams:
    def test_defaults(self):
        p = CursorParams()
        assert p.cursor is None
        assert p.page_size == 20

    def test_with_cursor(self):
        p = CursorParams(cursor="abc123", page_size=10)
        assert p.cursor == "abc123"
        assert p.page_size == 10


# --- Paginator.paginate_offset tests ---

class TestPaginateOffset:
    def test_basic_pagination(self):
        items = list(range(100))
        result = Paginator.paginate_offset(items[0:20], total=100, page=1, page_size=20)
        assert isinstance(result, PaginatedResponse)
        assert result.total == 100
        assert result.page == 1
        assert result.page_size == 20
        assert result.total_pages == 5
        assert result.has_next is True
        assert result.has_previous is False

    def test_last_page(self):
        items = list(range(80, 100))
        result = Paginator.paginate_offset(items, total=100, page=5, page_size=20)
        assert result.has_next is False
        assert result.has_previous is True

    def test_middle_page(self):
        items = list(range(20, 40))
        result = Paginator.paginate_offset(items, total=100, page=2, page_size=20)
        assert result.has_next is True
        assert result.has_previous is True

    def test_empty_results(self):
        result = Paginator.paginate_offset([], total=0, page=1, page_size=20)
        assert result.items == []
        assert result.total == 0
        assert result.total_pages == 0
        assert result.has_next is False
        assert result.has_previous is False

    def test_page_zero(self):
        items = list(range(10))
        result = Paginator.paginate_offset(items, total=100, page=0, page_size=20)
        assert result.page == 0
        assert result.has_next is True
        assert result.has_previous is False

    def test_negative_page(self):
        result = Paginator.paginate_offset([], total=100, page=-5, page_size=20)
        assert result.page == 0

    def test_page_size_zero(self):
        result = Paginator.paginate_offset([], total=100, page=1, page_size=0)
        assert result.total_pages == 0
        assert result.has_next is False

    def test_single_item(self):
        result = Paginator.paginate_offset([42], total=1, page=1, page_size=20)
        assert result.items == [42]
        assert result.total_pages == 1
        assert result.has_next is False
        assert result.has_previous is False


# --- Paginator cursor tests ---

class TestPaginateCursor:
    def test_basic_cursor(self):
        @dataclass
        class Item:
            id: int
            name: str

        items = [Item(id=i, name=f"item_{i}") for i in range(21)]  # 21 items (1 extra)
        result = Paginator.paginate_cursor(items, page_size=20, cursor_field="id")
        assert isinstance(result, CursorPaginatedResponse)
        assert len(result.items) == 20
        assert result.has_next is True
        assert result.has_previous is False
        assert result.next_cursor is not None
        assert result.previous_cursor is None

    def test_cursor_last_page(self):
        items = [{"id": i} for i in range(5)]  # 5 items, page_size=20
        result = Paginator.paginate_cursor(items, page_size=20, cursor_field="id")
        assert len(result.items) == 5
        assert result.has_next is False
        assert result.next_cursor is None

    def test_cursor_with_previous(self):
        items = [{"id": i} for i in range(21)]
        result = Paginator.paginate_cursor(items, page_size=20, cursor_field="id", cursor="prev_cursor")
        assert result.has_previous is True
        assert result.previous_cursor == "prev_cursor"

    def test_cursor_encode_decode(self):
        data = {"field": "id", "value": "42"}
        encoded = Paginator.encode_cursor(data)
        decoded = Paginator.decode_cursor(encoded)
        assert decoded == data

    def test_cursor_decode_invalid(self):
        with pytest.raises(ValueError, match="Invalid cursor"):
            Paginator.decode_cursor("not-a-valid-cursor!!!")

    def test_cursor_with_get_field(self):
        items = list(range(21))  # integers
        result = Paginator.paginate_cursor(items, page_size=20, get_field=lambda x: x)
        assert result.has_next is True
        assert result.next_cursor is not None

    def test_cursor_empty(self):
        result = Paginator.paginate_cursor([], page_size=20)
        assert result.items == []
        assert result.has_next is False
        assert result.has_previous is False

    def test_cursor_with_total(self):
        items = [{"id": i} for i in range(21)]
        result = Paginator.paginate_cursor(items, page_size=20, cursor_field="id", total=100)
        assert result.total == 100


# --- Dependency function tests ---

class TestDependencies:
    def test_paginate_default(self):
        params = paginate()
        assert isinstance(params, PaginationParams)
        assert params.page == 1
        assert params.page_size == 20

    def test_paginate_custom(self):
        params = paginate(page=3, page_size=10)
        assert params.page == 3
        assert params.page_size == 10

    def test_cursor_paginate_default(self):
        params = cursor_paginate()
        assert isinstance(params, CursorParams)
        assert params.cursor is None
        assert params.page_size == 20

    def test_cursor_paginate_custom(self):
        params = cursor_paginate(cursor="abc", page_size=50)
        assert params.cursor == "abc"
        assert params.page_size == 50
