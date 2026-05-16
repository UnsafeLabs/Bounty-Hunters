"""Tests for fastapi.fastapi.pagination module."""

import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi.pagination import (
    PaginatedResponse,
    PaginationParams,
    Paginator,
    decode_cursor,
    paginate,
)


class TestItem(BaseModel):
    id: int
    name: str


class TestPaginationParams:
    """PaginationParams computed properties."""

    def test_offset_defaults(self) -> None:
        p = PaginationParams(page=1, page_size=20)
        assert p.offset == 0
        assert p.limit == 20

    def test_offset_page_3(self) -> None:
        p = PaginationParams(page=3, page_size=10)
        assert p.offset == 20
        assert p.limit == 10

    def test_clamp_negative_page(self) -> None:
        p = PaginationParams(page=-5, page_size=10)
        assert p.page == 1
        assert p.offset == 0

    def test_clamp_zero_page(self) -> None:
        p = PaginationParams(page=0, page_size=10)
        assert p.page == 1

    def test_clamp_zero_page_size(self) -> None:
        p = PaginationParams(page=1, page_size=0)
        assert p.page_size == 1

    def test_clamp_large_page_size(self) -> None:
        p = PaginationParams(page=1, page_size=200)
        assert p.page_size == 100


class TestPaginateDependency:
    """paginate() dependency function."""

    def test_default_values(self) -> None:
        app = FastAPI()

        @app.get("/items")
        def get_items(p: PaginationParams = Depends(paginate)):
            return {"page": p.page, "page_size": p.page_size}

        client = TestClient(app)
        resp = client.get("/items")
        assert resp.status_code == 200
        data = resp.json()
        assert data["page"] == 1
        assert data["page_size"] == 20

    def test_custom_query_params(self) -> None:
        app = FastAPI()

        @app.get("/items")
        def get_items(p: PaginationParams = Depends(paginate)):
            return {"page": p.page, "page_size": p.page_size, "offset": p.offset}

        client = TestClient(app)
        resp = client.get("/items?page=3&page_size=15")
        assert resp.status_code == 200
        data = resp.json()
        assert data["page"] == 3
        assert data["page_size"] == 15
        assert data["offset"] == 30


class TestPaginateOffset:
    """Paginator.paginate_offset()."""

    def test_first_page(self) -> None:
        items = [{"id": i, "name": f"item_{i}"} for i in range(5)]
        result = Paginator.paginate_offset(items=items, total=25, page=1, page_size=5)
        assert len(result["items"]) == 5
        assert result["total"] == 25
        assert result["page"] == 1
        assert result["page_size"] == 5
        assert result["total_pages"] == 5
        assert result["has_next"] is True
        assert result["has_previous"] is False

    def test_last_page(self) -> None:
        items = [{"id": i, "name": f"item_{i}"} for i in range(5)]
        result = Paginator.paginate_offset(items=items, total=25, page=5, page_size=5)
        assert result["has_next"] is False
        assert result["has_previous"] is True
        assert result["total_pages"] == 5

    def test_middle_page(self) -> None:
        items = [{"id": i} for i in range(10)]
        result = Paginator.paginate_offset(items=items, total=50, page=2, page_size=10)
        assert result["has_next"] is True
        assert result["has_previous"] is True
        assert result["page"] == 2
        assert result["total_pages"] == 5

    def test_empty_items(self) -> None:
        result = Paginator.paginate_offset(items=[], total=0, page=1, page_size=10)
        assert result["items"] == []
        assert result["total"] == 0
        assert result["total_pages"] == 1
        assert result["has_next"] is False
        assert result["has_previous"] is False

    def test_single_item_total(self) -> None:
        result = Paginator.paginate_offset(items=[{"id": 1}], total=1, page=1, page_size=10)
        assert result["total_pages"] == 1
        assert result["has_next"] is False

    def test_clamp_page_zero(self) -> None:
        result = Paginator.paginate_offset(items=[], total=10, page=0, page_size=5)
        assert result["page"] == 1

    def test_clamp_page_negative(self) -> None:
        result = Paginator.paginate_offset(items=[], total=10, page=-1, page_size=5)
        assert result["page"] == 1

    def test_clamp_page_size_zero(self) -> None:
        result = Paginator.paginate_offset(items=[], total=10, page=1, page_size=0)
        assert result["page_size"] == 1

    def test_total_pages_with_remainder(self) -> None:
        result = Paginator.paginate_offset(items=[], total=23, page=1, page_size=5)
        assert result["total_pages"] == 5


class TestPaginateCursor:
    """Paginator.paginate_cursor()."""

    def test_has_next_with_extra_item(self) -> None:
        items = [{"id": i} for i in range(6)]  # 6 items, page_size=5
        result = Paginator.paginate_cursor(items=items, page_size=5, cursor_field="id")
        assert len(result["items"]) == 5
        assert result["has_next"] is True
        assert result["next_cursor"] is not None
        assert result["has_previous"] is False

    def test_no_next_when_exact_count(self) -> None:
        items = [{"id": i} for i in range(5)]
        result = Paginator.paginate_cursor(items=items, page_size=5, cursor_field="id")
        assert result["has_next"] is False
        assert result["next_cursor"] is None

    def test_empty_items(self) -> None:
        result = Paginator.paginate_cursor(items=[], page_size=10, cursor_field="id")
        assert result["has_next"] is False
        assert result["next_cursor"] is None

    def test_cursor_encodes_id(self) -> None:
        items = [{"id": 42, "name": "last"}]
        result = Paginator.paginate_cursor(items=items, page_size=0, cursor_field="id")
        assert result["next_cursor"] is not None
        decoded = Paginator.decode_cursor(result["next_cursor"])
        assert decoded.get("id") == 42

    def test_object_items_cursor(self) -> None:
        class Obj:
            def __init__(self, id_val):
                self.id = id_val
        items = [Obj(99)]
        result = Paginator.paginate_cursor(items=items, page_size=0, cursor_field="id")
        assert result["next_cursor"] is not None
        decoded = Paginator.decode_cursor(result["next_cursor"])
        assert decoded.get("id") == 99

    def test_clamp_page_size(self) -> None:
        result = Paginator.paginate_cursor(items=[{"id": 1}, {"id": 2}], page_size=0)
        assert result["page_size"] == 1
        assert len(result["items"]) == 1


class TestDecodeCursor:
    """Paginator.decode_cursor()."""

    def test_valid_cursor(self) -> None:
        import base64 as b64
        import json as j
        data = j.dumps({"id": 42, "page_size": 10})
        cursor = b64.urlsafe_b64encode(data.encode()).decode().rstrip("=")
        result = Paginator.decode_cursor(cursor)
        assert result["id"] == 42
        assert result["page_size"] == 10

    def test_invalid_nonsense(self) -> None:
        result = Paginator.decode_cursor("not-a-valid-cursor!!!")
        assert result == {}

    def test_empty_cursor(self) -> None:
        result = Paginator.decode_cursor("")
        assert result == {}


class TestPaginatedResponse:
    """PaginatedResponse generic model."""

    def test_basic_model(self) -> None:
        response = PaginatedResponse[TestItem](
            items=[TestItem(id=1, name="foo"), TestItem(id=2, name="bar")],
            total=20,
            page=1,
            page_size=10,
            total_pages=2,
            has_next=True,
            has_previous=False,
        )
        data = response.model_dump()
        assert data["items"][0]["id"] == 1
        assert data["total"] == 20
        assert data["has_next"] is True

    def test_json_serialization(self) -> None:
        response = PaginatedResponse[int](
            items=[1, 2, 3],
            total=3,
            page=1,
            page_size=3,
            total_pages=1,
            has_next=False,
            has_previous=False,
        )
        json_str = response.model_dump_json()
        assert "items" in json_str
        assert '"total":3' in json_str

from fastapi import Depends
