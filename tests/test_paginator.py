"""Tests for Paginator v3"""
import pytest
from paginator import Paginator, PaginatedResponse

class FakeItem:
    def __init__(self, id: int, name: str): self.id = id; self.name = name

class TestOffsetPagination:
    def test_page1(self):
        items = [FakeItem(i, f"item-{i}") for i in range(50)]
        p = Paginator(items, 50, page=1, page_size=10)
        r = p.offset_paginate()
        assert len(r.items) == 10; assert r.page == 1; assert r.has_next; assert not r.has_previous
    def test_last_page(self):
        r = Paginator([FakeItem(i,"x") for i in range(50)], 50, page=5, page_size=10).offset_paginate()
        assert len(r.items) == 10; assert not r.has_next; assert r.has_previous
    def test_empty(self):
        r = Paginator([], 0).offset_paginate()
        assert r.items == []; assert r.total == 0; assert r.total_pages == 1
    def test_page_zero_clamped(self):
        r = Paginator([FakeItem(1,"a")], 1, page=0).offset_paginate()
        assert r.page == 1
    def test_negative_page_clamped(self):
        r = Paginator([FakeItem(1,"a")], 1, page=-5).offset_paginate()
        assert r.page == 1

class TestCursorPagination:
    def test_first_page(self):
        items = [FakeItem(i, f"item-{i}") for i in range(30)]
        r = Paginator(items, 30, page_size=10).cursor_paginate("id")
        assert len(r.items) == 10; assert r.has_next; assert not r.has_previous; assert r.next_cursor
    def test_with_cursor(self):
        import base64, json
        cursor = base64.b64encode(json.dumps({"last_id": 9}).encode()).decode()
        items = [FakeItem(i, f"item-{i}") for i in range(30)]
        r = Paginator(items, 30, page_size=10).cursor_paginate("id", cursor)
        assert r.items[0].id > 9; assert r.has_previous
    def test_iter_all(self):
        items = [FakeItem(i, f"x") for i in range(10)]
        r = Paginator(items, 10).offset_paginate()
        assert hasattr(r, 'has_next')
