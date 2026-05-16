"""Tests for Paginator with async iterator and cursor-based pagination"""
import pytest
from paginator import Paginator, PaginatedResponse

class MockQuery:
    def __init__(self, total_items=100):
        self._total = total_items
        self._offset = 0
        self._limit = 20

    async def count(self):
        return self._total

    def offset(self, n):
        self._offset = n
        return self

    def limit(self, n):
        self._limit = n
        return self

    async def all(self):
        start = self._offset
        end = min(start + self._limit, self._total)
        return [f"item_{i}" for i in range(start, end)]

class TestPaginator:
    @pytest.mark.asyncio
    async def test_fetch_first_page(self):
        p = Paginator(MockQuery(100))
        page = await p.fetch_page()
        assert len(page.items) == 20
        assert page.total == 100
        assert page.has_next is True
        assert page.has_previous is False

    @pytest.mark.asyncio
    async def test_fetch_last_page(self):
        p = Paginator(MockQuery(10), offset=0, limit=10)
        page = await p.fetch_page()
        assert page.has_next is False

    @pytest.mark.asyncio
    async def test_iter_all_pages(self):
        p = Paginator(MockQuery(45), limit=20)
        pages = []
        async for page_items in p.iter_all():
            pages.extend(page_items)
        assert len(pages) == 45

    @pytest.mark.asyncio
    async def test_offset_clamping(self):
        p = Paginator(MockQuery(100), offset=-5)
        assert p.offset == 0

    @pytest.mark.asyncio
    async def test_limit_clamping(self):
        p = Paginator(MockQuery(100), limit=200)
        assert p.limit == 100

    def test_response_properties(self):
        resp = PaginatedResponse(items=["a","b"], total=10, offset=0, limit=5)
        assert resp.next_offset == 5
        assert resp.previous_offset is None
        assert resp.has_next is True
