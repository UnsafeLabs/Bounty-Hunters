"""Tests for FastAPI pagination module.

Covers offset-based and cursor-based pagination, dependency injection,
edge cases, and Pydantic model wrapping.
"""

from __future__ import annotations

from typing import Any

import pytest
from pydantic import BaseModel

from fastapi import Depends, FastAPI
from fastapi.pagination import (
    CursorPaginatedResponse,
    CursorPaginator,
    CursorParams,
    OffsetParams,
    PaginatedResponse,
    Paginator,
    paginate,
    paginate_cursor,
)
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

class Item(BaseModel):
    id: int
    name: str


class ItemOut(BaseModel):
    id: int
    name: str


SAMPLE_DATA: list[dict[str, Any]] = [
    {"id": i, "name": f"item-{i:03d}"} for i in range(1, 101)
]


@pytest.fixture
def sample_items() -> list[dict[str, Any]]:
    return [dict(d) for d in SAMPLE_DATA]


@pytest.fixture
def sample_models() -> list[Item]:
    return [Item(**d) for d in SAMPLE_DATA]


# ---------------------------------------------------------------------------
# OffsetParams unit tests
# ---------------------------------------------------------------------------

class TestOffsetParams:
    def test_defaults(self):
        p = OffsetParams()
        assert p.page == 1
        assert p.page_size == 20
        assert p.offset == 0
        assert p.limit == 20

    def test_page_2(self):
        p = OffsetParams(page=2, page_size=10)
        assert p.offset == 10
        assert p.limit == 10

    def test_page_5(self):
        p = OffsetParams(page=5, page_size=25)
        assert p.offset == 100
        assert p.limit == 25


# ---------------------------------------------------------------------------
# Paginator offset tests
# ---------------------------------------------------------------------------

class TestPaginator:
    def test_first_page(self, sample_items):
        params = OffsetParams(page=1, page_size=10)
        paginator = Paginator(sample_items, params)
        resp = paginator.response()

        assert len(resp.items) == 10
        assert resp.items[0]["id"] == 1
        assert resp.total == 100
        assert resp.page == 1
        assert resp.page_size == 10
        assert resp.total_pages == 10
        assert resp.has_next is True
        assert resp.has_previous is False

    def test_last_page(self, sample_items):
        params = OffsetParams(page=10, page_size=10)
        paginator = Paginator(sample_items, params)
        resp = paginator.response()

        assert len(resp.items) == 10
        assert resp.items[-1]["id"] == 100
        assert resp.total_pages == 10
        assert resp.has_next is False
        assert resp.has_previous is True

    def test_middle_page(self, sample_items):
        params = OffsetParams(page=5, page_size=10)
        paginator = Paginator(sample_items, params)
        resp = paginator.response()

        assert len(resp.items) == 10
        assert resp.items[0]["id"] == 41
        assert resp.items[-1]["id"] == 50
        assert resp.has_next is True
        assert resp.has_previous is True

    def test_partial_last_page(self, sample_items):
        params = OffsetParams(page=4, page_size=30)
        paginator = Paginator(sample_items, params)
        resp = paginator.response()

        assert len(resp.items) == 10  # 100 items, page 4 of 30 = items 91-100
        assert resp.total_pages == 4
        assert resp.has_next is False
        assert resp.has_previous is True

    def test_empty_items(self):
        params = OffsetParams(page=1, page_size=10)
        paginator = Paginator([], params)
        resp = paginator.response()

        assert len(resp.items) == 0
        assert resp.total == 0
        assert resp.total_pages == 1  # at least 1 page even when empty
        assert resp.has_next is False
        assert resp.has_previous is False

    def test_page_beyond_range(self, sample_items):
        """Requesting page 99 of 100 items at size 10 should return empty."""
        params = OffsetParams(page=99, page_size=10)
        paginator = Paginator(sample_items, params)
        resp = paginator.response()

        assert len(resp.items) == 0
        assert resp.total == 100
        assert resp.page == 99
        assert resp.has_next is False

    def test_single_item_per_page(self, sample_items):
        params = OffsetParams(page=50, page_size=1)
        paginator = Paginator(sample_items, params)
        resp = paginator.response()

        assert len(resp.items) == 1
        assert resp.items[0]["id"] == 50
        assert resp.total_pages == 100

    def test_model_serialization(self, sample_models):
        params = OffsetParams(page=1, page_size=5)
        paginator = Paginator(sample_models, params)
        resp = paginator.response(model=ItemOut)

        assert len(resp.items) == 5
        assert isinstance(resp.items[0], ItemOut)
        assert resp.items[0].id == 1

    def test_all_items_single_page(self, sample_items):
        params = OffsetParams(page=1, page_size=200)
        paginator = Paginator(sample_items, params)
        resp = paginator.response()

        assert len(resp.items) == 100
        assert resp.total_pages == 1
        assert resp.has_next is False
        assert resp.has_previous is False


# ---------------------------------------------------------------------------
# CursorParams unit tests
# ---------------------------------------------------------------------------

class TestCursorParams:
    def test_defaults(self):
        p = CursorParams()
        assert p.cursor is None
        assert p.page_size == 20
        assert p.direction == "next"

    def test_decode_none(self):
        p = CursorParams(cursor=None)
        assert p.decode_cursor() is None

    def test_encode_decode_roundtrip(self):
        data = {"id": 42}
        encoded = CursorParams.encode_cursor(data)
        p = CursorParams(cursor=encoded)
        assert p.decode_cursor() == data

    def test_decode_invalid_cursor(self):
        p = CursorParams(cursor="not-valid-base64!!!")
        assert p.decode_cursor() is None


# ---------------------------------------------------------------------------
# CursorPaginator tests
# ---------------------------------------------------------------------------

class TestCursorPaginator:
    def test_first_page_no_cursor(self, sample_models):
        params = CursorParams(page_size=10)
        paginator = CursorPaginator(sample_models, params, cursor_field="id")
        resp = paginator.response()

        assert len(resp.items) == 10
        assert resp.items[0].id == 1
        assert resp.items[-1].id == 10
        assert resp.total == 100
        assert resp.has_next is True
        assert resp.has_previous is False
        assert resp.next_cursor is not None
        assert resp.previous_cursor is None

    def test_next_page_with_cursor(self, sample_models):
        # Get first page
        params1 = CursorParams(page_size=10)
        paginator1 = CursorPaginator(sample_models, params1, cursor_field="id")
        resp1 = paginator1.response()

        assert resp1.next_cursor is not None

        # Use cursor for next page
        params2 = CursorParams(cursor=resp1.next_cursor, page_size=10, direction="next")
        paginator2 = CursorPaginator(sample_models, params2, cursor_field="id")
        resp2 = paginator2.response()

        assert len(resp2.items) == 10
        assert resp2.items[0].id == 11
        assert resp2.items[-1].id == 20
        assert resp2.has_previous is True
        assert resp2.previous_cursor is not None

    def test_previous_page_with_cursor(self, sample_models):
        # Get second page first
        params1 = CursorParams(page_size=10)
        paginator1 = CursorPaginator(sample_models, params1, cursor_field="id")
        resp1 = paginator1.response()

        # Get second page
        params2 = CursorParams(cursor=resp1.next_cursor, page_size=10, direction="next")
        paginator2 = CursorPaginator(sample_models, params2, cursor_field="id")
        resp2 = paginator2.response()

        # Go back
        params3 = CursorParams(cursor=resp2.previous_cursor, page_size=10, direction="previous")
        paginator3 = CursorPaginator(sample_models, params3, cursor_field="id")
        resp3 = paginator3.response()

        assert len(resp3.items) == 10
        assert resp3.items[-1].id == 10  # previous: items < 11, reversed, top 10

    def test_last_page_no_next(self, sample_models):
        # Navigate to last
        params = CursorParams(page_size=100)
        paginator = CursorPaginator(sample_models, params, cursor_field="id")
        resp = paginator.response()

        assert resp.has_next is False
        assert resp.next_cursor is None

    def test_empty_items(self):
        params = CursorParams(page_size=10)
        paginator = CursorPaginator([], params, cursor_field="id")
        resp = paginator.response()

        assert len(resp.items) == 0
        assert resp.total == 0
        assert resp.has_next is False
        assert resp.has_previous is False

    def test_smaller_than_page_size(self, sample_models):
        params = CursorParams(page_size=200)
        paginator = CursorPaginator(sample_models, params, cursor_field="id")
        resp = paginator.response()

        assert len(resp.items) == 100
        assert resp.has_next is False

    def test_model_serialization(self, sample_models):
        params = CursorParams(page_size=5)
        paginator = CursorPaginator(sample_models, params, cursor_field="id")
        resp = paginator.response(model=ItemOut)

        assert len(resp.items) == 5
        assert isinstance(resp.items[0], ItemOut)


# ---------------------------------------------------------------------------
# Integration tests — FastAPI app with dependency injection
# ---------------------------------------------------------------------------

@pytest.fixture
def app():
    app = FastAPI()

    all_items = [Item(**d) for d in SAMPLE_DATA]

    @app.get("/items/offset")
    def list_offset(p: OffsetParams = Depends(paginate)):
        paginator = Paginator(all_items, p)
        return paginator.response(model=ItemOut)

    @app.get("/items/cursor")
    def list_cursor(p: CursorParams = Depends(paginate_cursor)):
        paginator = CursorPaginator(all_items, p, cursor_field="id")
        return paginator.response(model=ItemOut)

    return app


@pytest.fixture
def client(app):
    return TestClient(app)


class TestIntegration:
    def test_offset_endpoint_defaults(self, client):
        resp = client.get("/items/offset")
        assert resp.status_code == 200

        data = resp.json()
        assert len(data["items"]) == 20
        assert data["total"] == 100
        assert data["page"] == 1
        assert data["page_size"] == 20
        assert data["total_pages"] == 5
        assert data["has_next"] is True
        assert data["has_previous"] is False

    def test_offset_endpoint_page_3(self, client):
        resp = client.get("/items/offset?page=3&page_size=10")
        assert resp.status_code == 200

        data = resp.json()
        assert len(data["items"]) == 10
        assert data["items"][0]["id"] == 21
        assert data["page"] == 3

    def test_offset_endpoint_invalid_page_rejected_by_fastapi(self, client):
        """FastAPI Query(ge=1) should reject page=0 with 422."""
        resp = client.get("/items/offset?page=0")
        assert resp.status_code == 422

    def test_offset_endpoint_negative_page_rejected(self, client):
        resp = client.get("/items/offset?page=-1")
        assert resp.status_code == 422

    def test_cursor_endpoint_defaults(self, client):
        resp = client.get("/items/cursor")
        assert resp.status_code == 200

        data = resp.json()
        assert len(data["items"]) == 20
        assert data["total"] == 100
        assert data["has_next"] is True
        assert data["has_previous"] is False
        assert data["next_cursor"] is not None
        assert data["previous_cursor"] is None

    def test_cursor_endpoint_paginate_forward(self, client):
        page1 = client.get("/items/cursor?page_size=10").json()
        cursor = page1["next_cursor"]

        page2 = client.get(f"/items/cursor?cursor={cursor}&page_size=10").json()
        assert len(page2["items"]) == 10
        assert page2["items"][0]["id"] == 11
        assert page2["has_previous"] is True

    def test_cursor_endpoint_invalid_cursor_handled(self, client):
        resp = client.get("/items/cursor?cursor=bad_cursor_value")
        # Invalid cursor is treated as None — returns first page
        assert resp.status_code == 200
        data = resp.json()
        assert data["items"][0]["id"] == 1

    def test_paginated_response_serialization(self, client):
        resp = client.get("/items/offset?page=1&page_size=5")
        data = resp.json()

        # Verify all expected fields exist
        for key in ("items", "total", "page", "page_size", "total_pages", "has_next", "has_previous"):
            assert key in data, f"Missing key: {key}"

    def test_cursor_response_serialization(self, client):
        resp = client.get("/items/cursor?page_size=5")
        data = resp.json()

        for key in ("items", "total", "next_cursor", "previous_cursor", "has_next", "has_previous"):
            assert key in data, f"Missing key: {key}"
