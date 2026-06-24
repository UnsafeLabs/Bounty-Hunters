"""Tests for fastapi.pagination module."""

from __future__ import annotations

import pytest
from fastapi import FastAPI, Depends
from fastapi.pagination import (
    CursorInfo,
    CursorPaginatedResponse,
    CursorPaginationParams,
    PaginatedResponse,
    PaginationParams,
    Paginator,
    paginate_cursor,
    paginate_offset,
)
from fastapi.testclient import TestClient
from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

class Item(BaseModel):
    id: int
    name: str


ALL_ITEMS = [Item(id=i, name=f"item-{i}") for i in range(1, 51)]  # 50 items


def _get_items_page(skip: int, limit: int) -> list[Item]:
    return ALL_ITEMS[skip : skip + limit]


def _create_offset_app(paginator: Paginator | None = None) -> FastAPI:
    paginator = paginator or Paginator()
    app = FastAPI()

    @app.get("/items")
    async def list_items(
        pagination: PaginationParams = Depends(paginator.paginate_offset),
    ):
        items = _get_items_page(pagination.skip, pagination.limit)
        return paginator.offset_response(items, total=len(ALL_ITEMS), params=pagination)

    return app


def _create_cursor_app(paginator: Paginator | None = None) -> FastAPI:
    paginator = paginator or Paginator()
    app = FastAPI()

    @app.get("/items")
    async def list_items(
        pagination: CursorPaginationParams = Depends(paginator.paginate_cursor),
    ):
        offset = 0
        if pagination.cursor:
            offset = CursorInfo.decode(pagination.cursor).offset

        # Fetch one extra to detect has_next
        raw = _get_items_page(offset, pagination.page_size + 1)
        has_next = len(raw) > pagination.page_size
        items = raw[: pagination.page_size]
        return paginator.cursor_response(
            items, has_next, pagination, current_offset=offset
        )

    return app


def _create_module_level_app() -> FastAPI:
    """App using the module-level convenience functions."""
    app = FastAPI()

    @app.get("/offset")
    async def offset_items(
        pagination: PaginationParams = Depends(paginate_offset),
    ):
        items = _get_items_page(pagination.skip, pagination.limit)
        return Paginator.offset_response(items, total=len(ALL_ITEMS), params=pagination)

    @app.get("/cursor")
    async def cursor_items(
        pagination: CursorPaginationParams = Depends(paginate_cursor),
    ):
        offset = 0
        if pagination.cursor:
            offset = CursorInfo.decode(pagination.cursor).offset
        raw = _get_items_page(offset, pagination.page_size + 1)
        has_next = len(raw) > pagination.page_size
        items = raw[: pagination.page_size]
        return Paginator.cursor_response(
            items, has_next, pagination, current_offset=offset
        )

    return app


# ---------------------------------------------------------------------------
# PaginationParams (model)
# ---------------------------------------------------------------------------


class TestPaginationParams:
    def test_defaults(self):
        p = PaginationParams()
        assert p.page == 1
        assert p.page_size == 20
        assert p.skip == 0
        assert p.limit == 20

    def test_skip_calculation(self):
        p = PaginationParams(page=3, page_size=10)
        assert p.skip == 20
        assert p.limit == 10

    def test_page_1(self):
        p = PaginationParams(page=1, page_size=15)
        assert p.skip == 0

    def test_boundary_values(self):
        p = PaginationParams(page=1, page_size=1)
        assert p.skip == 0
        assert p.limit == 1


class TestCursorPaginationParams:
    def test_defaults(self):
        c = CursorPaginationParams()
        assert c.cursor is None
        assert c.page_size == 20

    def test_with_cursor(self):
        info = CursorInfo(offset=40)
        c = CursorPaginationParams(cursor=info.encode(), page_size=10)
        assert c.cursor is not None


# ---------------------------------------------------------------------------
# CursorInfo (encode/decode round-trip)
# ---------------------------------------------------------------------------


class TestCursorInfo:
    def test_round_trip(self):
        for offset in (0, 1, 10, 999, 0):
            info = CursorInfo(offset=offset)
            encoded = info.encode()
            decoded = CursorInfo.decode(encoded)
            assert decoded.offset == offset

    def test_encode_is_url_safe(self):
        info = CursorInfo(offset=42)
        encoded = info.encode()
        # base64url should not contain + / =
        assert "+" not in encoded
        assert "/" not in encoded
        assert "=" not in encoded

    def test_decode_invalid_raises(self):
        with pytest.raises(ValueError, match="Invalid cursor"):
            CursorInfo.decode("not-a-valid-cursor!!!")

    def test_decode_negative_offset_raises(self):
        import base64, json
        payload = json.dumps({"o": -1})
        bad = base64.urlsafe_b64encode(payload.encode()).decode()
        with pytest.raises(ValueError, match="Invalid cursor"):
            CursorInfo.decode(bad)


# ---------------------------------------------------------------------------
# Offset-based pagination (HTTP)
# ---------------------------------------------------------------------------


class TestOffsetPagination:
    def test_first_page(self):
        client = TestClient(_create_offset_app())
        resp = client.get("/items", params={"page": 1, "page_size": 10})
        assert resp.status_code == 200
        data = resp.json()
        assert data["page"] == 1
        assert data["page_size"] == 10
        assert data["total"] == 50
        assert data["total_pages"] == 5
        assert data["has_next"] is True
        assert data["has_previous"] is False
        assert len(data["items"]) == 10
        assert data["items"][0]["id"] == 1

    def test_last_page(self):
        client = TestClient(_create_offset_app())
        resp = client.get("/items", params={"page": 5, "page_size": 10})
        data = resp.json()
        assert data["has_next"] is False
        assert data["has_previous"] is True
        assert len(data["items"]) == 10

    def test_middle_page(self):
        client = TestClient(_create_offset_app())
        resp = client.get("/items", params={"page": 3, "page_size": 10})
        data = resp.json()
        assert data["has_next"] is True
        assert data["has_previous"] is True
        assert data["items"][0]["id"] == 21

    def test_page_beyond_total(self):
        client = TestClient(_create_offset_app())
        resp = client.get("/items", params={"page": 100, "page_size": 10})
        data = resp.json()
        assert data["items"] == []
        assert data["has_next"] is False
        assert data["has_previous"] is True

    def test_defaults(self):
        client = TestClient(_create_offset_app())
        resp = client.get("/items")
        data = resp.json()
        assert data["page"] == 1
        assert data["page_size"] == 20
        assert len(data["items"]) == 20

    def test_total_pages_with_remainder(self):
        """50 items / 15 per page = 4 pages (3x15 + 1x5)."""
        client = TestClient(_create_offset_app())
        resp = client.get("/items", params={"page": 1, "page_size": 15})
        data = resp.json()
        assert data["total_pages"] == 4

    def test_single_item_per_page(self):
        client = TestClient(_create_offset_app())
        resp = client.get("/items", params={"page": 1, "page_size": 1})
        data = resp.json()
        assert data["total_pages"] == 50
        assert len(data["items"]) == 1


# ---------------------------------------------------------------------------
# Cursor-based pagination (HTTP)
# ---------------------------------------------------------------------------


class TestCursorPagination:
    def test_first_page_no_cursor(self):
        client = TestClient(_create_cursor_app())
        resp = client.get("/items", params={"page_size": 10})
        assert resp.status_code == 200
        data = resp.json()
        assert data["has_next"] is True
        assert data["has_previous"] is False
        assert data["next_cursor"] is not None
        assert data["previous_cursor"] is None
        assert len(data["items"]) == 10
        assert data["items"][0]["id"] == 1

    def test_follow_cursor(self):
        client = TestClient(_create_cursor_app())
        # Page 1
        resp1 = client.get("/items", params={"page_size": 10})
        data1 = resp1.json()
        cursor = data1["next_cursor"]

        # Page 2
        resp2 = client.get("/items", params={"page_size": 10, "cursor": cursor})
        data2 = resp2.json()
        assert data2["items"][0]["id"] == 11
        assert data2["has_previous"] is True
        assert data2["previous_cursor"] is not None

    def test_last_page(self):
        client = TestClient(_create_cursor_app())
        # Navigate to last page
        resp = client.get("/items", params={"page_size": 20})
        data = resp.json()
        cursor = data["next_cursor"]
        assert cursor is not None

        resp2 = client.get("/items", params={"page_size": 20, "cursor": cursor})
        data2 = resp2.json()
        assert len(data2["items"]) == 20
        assert data2["next_cursor"] is not None

        resp3 = client.get(
            "/items", params={"page_size": 20, "cursor": data2["next_cursor"]}
        )
        data3 = resp3.json()
        assert len(data3["items"]) == 10  # 50 - 40 = 10
        assert data3["has_next"] is False

    def test_invalid_cursor(self):
        client = TestClient(_create_cursor_app(), raise_server_exceptions=False)
        resp = client.get("/items", params={"cursor": "garbage!!!", "page_size": 10})
        assert resp.status_code == 500

    def test_default_page_size(self):
        client = TestClient(_create_cursor_app())
        resp = client.get("/items")
        data = resp.json()
        assert data["page_size"] == 20
        assert len(data["items"]) == 20


# ---------------------------------------------------------------------------
# Paginator class configuration
# ---------------------------------------------------------------------------


class TestPaginatorConfig:
    def test_custom_default_page_size(self):
        p = Paginator(default_page_size=5)
        app = _create_offset_app(p)
        client = TestClient(app)
        resp = client.get("/items")
        data = resp.json()
        assert data["page_size"] == 5

    def test_max_page_size_clamping(self):
        p = Paginator(max_page_size=25)
        app = _create_offset_app(p)
        client = TestClient(app)
        resp = client.get("/items", params={"page_size": 100})
        data = resp.json()
        assert data["page_size"] == 25


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------


class TestEdgeCases:
    def test_empty_dataset(self):
        """Paginator should handle zero items gracefully."""
        app = FastAPI()
        paginator = Paginator()

        @app.get("/items")
        async def list_items(
            pagination: PaginationParams = Depends(paginator.paginate_offset),
        ):
            return paginator.offset_response([], total=0, params=pagination)

        client = TestClient(app)
        resp = client.get("/items")
        data = resp.json()
        assert data["items"] == []
        assert data["total"] == 0
        assert data["total_pages"] == 1
        assert data["has_next"] is False
        assert data["has_previous"] is False

    def test_page_zero_clamped_to_one(self):
        client = TestClient(_create_offset_app())
        resp = client.get("/items", params={"page": 0, "page_size": 10})
        # Query(ge=1) should reject page=0 with 422
        assert resp.status_code == 422

    def test_negative_page_rejected(self):
        client = TestClient(_create_offset_app())
        resp = client.get("/items", params={"page": -1, "page_size": 10})
        assert resp.status_code == 422

    def test_page_size_zero_rejected(self):
        client = TestClient(_create_offset_app())
        resp = client.get("/items", params={"page": 1, "page_size": 0})
        assert resp.status_code == 422

    def test_page_size_over_max_rejected(self):
        client = TestClient(_create_offset_app())
        resp = client.get("/items", params={"page": 1, "page_size": 101})
        assert resp.status_code == 422

    def test_total_exact_multiple_of_page_size(self):
        """When total == page_size * page, has_next should be False."""
        app = FastAPI()
        paginator = Paginator()
        # 20 items, page_size=10 → exactly 2 pages
        items = [Item(id=i, name=f"item-{i}") for i in range(1, 21)]

        @app.get("/items")
        async def list_items(
            pagination: PaginationParams = Depends(paginator.paginate_offset),
        ):
            page_items = items[pagination.skip : pagination.skip + pagination.limit]
            return paginator.offset_response(page_items, total=20, params=pagination)

        client = TestClient(app)

        # Last page: page=2, page_size=10, total=20
        resp = client.get("/items", params={"page": 2, "page_size": 10})
        data = resp.json()
        assert data["total"] == 20
        assert data["total_pages"] == 2
        assert data["has_next"] is False
        assert data["has_previous"] is True
        assert len(data["items"]) == 10

        # First page should have has_next=True
        resp1 = client.get("/items", params={"page": 1, "page_size": 10})
        data1 = resp1.json()
        assert data1["has_next"] is True
        assert data1["has_previous"] is False


class TestPaginatorValidation:
    def test_default_page_size_zero_raises(self):
        with pytest.raises(ValueError, match="default_page_size must be >= 1"):
            Paginator(default_page_size=0)

    def test_default_page_size_negative_raises(self):
        with pytest.raises(ValueError, match="default_page_size must be >= 1"):
            Paginator(default_page_size=-5)

    def test_max_page_size_zero_raises(self):
        with pytest.raises(ValueError, match="max_page_size must be >= 1"):
            Paginator(max_page_size=0)

    def test_max_page_size_negative_raises(self):
        with pytest.raises(ValueError, match="max_page_size must be >= 1"):
            Paginator(max_page_size=-1)

    def test_default_exceeds_max_raises(self):
        with pytest.raises(ValueError, match="must not exceed"):
            Paginator(default_page_size=50, max_page_size=10)

    def test_valid_custom_values(self):
        p = Paginator(default_page_size=5, max_page_size=50)
        assert p.default_page_size == 5
        assert p.max_page_size == 50


# ---------------------------------------------------------------------------
# Module-level convenience functions
# ---------------------------------------------------------------------------


class TestModuleLevel:
    def test_paginate_offset_dependency(self):
        app = _create_module_level_app()
        client = TestClient(app)
        resp = client.get("/offset", params={"page": 2, "page_size": 10})
        data = resp.json()
        assert data["page"] == 2
        assert data["items"][0]["id"] == 11

    def test_paginate_cursor_dependency(self):
        app = _create_module_level_app()
        client = TestClient(app)
        resp = client.get("/cursor", params={"page_size": 10})
        data = resp.json()
        assert data["has_next"] is True
        assert len(data["items"]) == 10
