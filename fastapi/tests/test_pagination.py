"""Tests for fastapi.pagination module."""

import pytest

from fastapi.pagination import (
    CursorPaginatedResponse,
    CursorPaginator,
    CursorPaginationParams,
    PaginatedResponse,
    PaginationParams,
    Paginator,
    cursor_paginate,
    paginate,
)


# ============================================================================
# Paginator (offset-based)
# ============================================================================


class TestPaginator:
    """Tests for the Paginator class."""

    def test_basic_pagination(self):
        p = Paginator(page=0, page_size=10)
        assert p.offset == 0
        assert p.limit == 10

    def test_page_calculation(self):
        p = Paginator(page=2, page_size=10)
        assert p.offset == 20
        assert p.limit == 10

    def test_response_basic(self):
        p = Paginator(page=0, page_size=10)
        resp = p.response(items=[1, 2, 3], total=25)
        assert resp["items"] == [1, 2, 3]
        assert resp["total"] == 25
        assert resp["page"] == 0
        assert resp["page_size"] == 10
        assert resp["total_pages"] == 3
        assert resp["has_next"] is True
        assert resp["has_previous"] is False

    def test_response_last_page(self):
        p = Paginator(page=2, page_size=10)
        resp = p.response(items=[21, 22, 23, 24, 25], total=25)
        assert resp["has_next"] is False
        assert resp["has_previous"] is True

    def test_response_first_page(self):
        p = Paginator(page=0, page_size=10)
        resp = p.response(items=list(range(10)), total=30)
        assert resp["has_next"] is True
        assert resp["has_previous"] is False

    def test_response_empty_results(self):
        p = Paginator(page=0, page_size=10)
        resp = p.response(items=[], total=0)
        assert resp["total_pages"] == 0
        assert resp["has_next"] is False
        assert resp["has_previous"] is False

    def test_response_single_page(self):
        p = Paginator(page=0, page_size=10)
        resp = p.response(items=[1, 2, 3], total=3)
        assert resp["total_pages"] == 1
        assert resp["has_next"] is False
        assert resp["has_previous"] is False

    def test_clamp_page_negative(self):
        p = Paginator(page=-5, page_size=10)
        assert p.page == 0
        assert p.offset == 0

    def test_clamp_page_size_zero(self):
        p = Paginator(page=0, page_size=0)
        assert p.page_size == 1

    def test_clamp_page_size_negative(self):
        p = Paginator(page=0, page_size=-5)
        assert p.page_size == 1

    def test_clamp_page_size_over_max(self):
        p = Paginator(page=0, page_size=500)
        assert p.page_size == 100

    def test_clamp_page_size_at_max(self):
        p = Paginator(page=0, page_size=100)
        assert p.page_size == 100

    def test_total_pages_calculation(self):
        assert Paginator._calculate_total_pages(0, 10) == 0
        assert Paginator._calculate_total_pages(1, 10) == 1
        assert Paginator._calculate_total_pages(10, 10) == 1
        assert Paginator._calculate_total_pages(11, 10) == 2
        assert Paginator._calculate_total_pages(100, 10) == 10
        assert Paginator._calculate_total_pages(101, 10) == 11

    def test_edge_page_0(self):
        p = Paginator(page=0, page_size=10)
        assert p.offset == 0

    def test_edge_page_size_1(self):
        p = Paginator(page=5, page_size=1)
        assert p.offset == 5
        assert p.limit == 1


# ============================================================================
# CursorPaginator (cursor-based)
# ============================================================================


class TestCursorPaginator:
    """Tests for the CursorPaginator class."""

    def test_basic_cursor_pagination(self):
        p = CursorPaginator(cursor=None, page_size=10)
        assert p.offset == 0
        assert p.limit == 11  # +1 for has_next detection

    def test_response_first_page(self):
        p = CursorPaginator(cursor=None, page_size=3)
        items = [1, 2, 3, 4]  # 4 items (more than page_size)
        resp = p.response(items)
        assert resp["items"] == [1, 2, 3]
        assert resp["has_next"] is True
        assert resp["has_previous"] is False
        assert resp["next_cursor"] is not None
        assert resp["previous_cursor"] is None

    def test_response_last_page(self):
        p = CursorPaginator(cursor=None, page_size=3)
        items = [1, 2]  # fewer than page_size
        resp = p.response(items)
        assert resp["items"] == [1, 2]
        assert resp["has_next"] is False
        assert resp["has_previous"] is False
        assert resp["next_cursor"] is None

    def test_response_middle_page(self):
        # First page
        p1 = CursorPaginator(cursor=None, page_size=3)
        items1 = [1, 2, 3, 4]
        resp1 = p1.response(items1)

        # Second page using next_cursor
        p2 = CursorPaginator(cursor=resp1["next_cursor"], page_size=3)
        assert p2.offset == 3  # Should be offset 3

    def test_cursor_encode_decode(self):
        cursor = CursorPaginator._encode_cursor(42)
        offset = CursorPaginator._decode_cursor(cursor)
        assert offset == 42

    def test_cursor_decode_invalid(self):
        assert CursorPaginator._decode_cursor("invalid") == 0
        assert CursorPaginator._decode_cursor("") == 0

    def test_cursor_decode_none(self):
        p = CursorPaginator(cursor=None)
        assert p.offset == 0

    def test_clamp_page_size(self):
        p = CursorPaginator(page_size=0)
        assert p.page_size == 1

        p = CursorPaginator(page_size=500)
        assert p.page_size == 100

    def test_response_empty(self):
        p = CursorPaginator(page_size=10)
        resp = p.response([])
        assert resp["items"] == []
        assert resp["has_next"] is False
        assert resp["has_previous"] is False
        assert resp["next_cursor"] is None

    def test_response_exact_page_size(self):
        p = CursorPaginator(page_size=3)
        items = [1, 2, 3]  # exactly page_size, no extra
        resp = p.response(items)
        assert resp["items"] == [1, 2, 3]
        assert resp["has_next"] is False


# ============================================================================
# PaginationParams (Pydantic models)
# ============================================================================


class TestPaginationParams:
    """Tests for the PaginationParams Pydantic model."""

    def test_defaults(self):
        p = PaginationParams()
        assert p.page == 1
        assert p.page_size == 20

    def test_custom_values(self):
        p = PaginationParams(page=5, page_size=50)
        assert p.page == 5
        assert p.page_size == 50

    def test_validation_page_negative(self):
        with pytest.raises(Exception):
            PaginationParams(page=-1)

    def test_validation_page_size_zero(self):
        with pytest.raises(Exception):
            PaginationParams(page_size=0)

    def test_validation_page_size_over_max(self):
        with pytest.raises(Exception):
            PaginationParams(page_size=101)


class TestCursorPaginationParams:
    """Tests for the CursorPaginationParams Pydantic model."""

    def test_defaults(self):
        p = CursorPaginationParams()
        assert p.cursor is None
        assert p.page_size == 20

    def test_custom_values(self):
        p = CursorPaginationParams(cursor="abc123", page_size=50)
        assert p.cursor == "abc123"
        assert p.page_size == 50


# ============================================================================
# Dependency functions
# ============================================================================


class TestDependencies:
    """Tests for paginate and cursor_paginate dependency functions."""

    def test_paginate_defaults(self):
        result = paginate()
        assert result == {"page": 1, "page_size": 20}

    def test_paginate_custom(self):
        result = paginate(page=3, page_size=50)
        assert result == {"page": 3, "page_size": 50}

    def test_cursor_paginate_defaults(self):
        result = cursor_paginate()
        assert result == {"cursor": None, "page_size": 20}

    def test_cursor_paginate_custom(self):
        result = cursor_paginate(cursor="abc", page_size=50)
        assert result == {"cursor": "abc", "page_size": 50}
