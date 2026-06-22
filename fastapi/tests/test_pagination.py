import pytest
from fastapi.pagination import (
    Paginator, PaginatedResponse, CursorPaginatedResponse,
    PaginationParams, CursorParams,
)

class TestPaginator:
    def test_offset_pagination_basic(self):
        items = [{"id": i} for i in range(50)]
        result = Paginator.paginate(items, 100, page=1, page_size=10)
        assert result.page == 1
        assert result.page_size == 10
        assert result.total == 100
        assert result.total_pages == 10
        assert result.has_next is True
        assert result.has_previous is False
        assert len(result.items) == 50

    def test_offset_pagination_last_page(self):
        result = Paginator.paginate([], 100, page=10, page_size=10)
        assert result.has_next is False
        assert result.has_previous is True

    def test_offset_empty_result(self):
        result = Paginator.paginate([], 0, page=1, page_size=20)
        assert result.total_pages == 0
        assert result.has_next is False
        assert result.has_previous is False

    def test_offset_edge_cases(self):
        result = Paginator.paginate([], 100, page=0, page_size=20)
        assert result.page == 1  # corrected to 1

    def test_cursor_pagination_basic(self):
        items = [{"id": i} for i in range(20)]
        result = Paginator.paginate_cursor(items, has_more=True, next_cursor_value="abc123")
        assert len(result.items) == 20
        assert result.has_more is True
        assert result.next_cursor is not None

    def test_cursor_no_more(self):
        result = Paginator.paginate_cursor([], has_more=False)
        assert result.has_more is False
        assert result.next_cursor is None

    def test_cursor_decode(self):
        result = Paginator.decode_cursor("eyJjdXJzb3IiOiAiMTIzIn0=")
        assert result == "123"

    def test_pagination_params_model(self):
        params = PaginationParams(page=2, page_size=50)
        assert params.page == 2
        assert params.page_size == 50
