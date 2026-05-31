import base64
import json
from typing import Annotated

import pytest
from fastapi import FastAPI, Depends, Query
from fastapi.testclient import TestClient
from pydantic import BaseModel

from fastapi.pagination import (
    CursorParams,
    PaginatedResponse,
    Paginator,
    _decode_cursor,
    _encode_cursor,
    paginate,
)


class Item(BaseModel):
    id: int
    name: str


SAMPLE_ITEMS = [Item(id=i, name=f"item-{i}") for i in range(1, 51)]


def _slice_items(items: list[Item], page: int, page_size: int) -> list[Item]:
    start = (page - 1) * page_size
    return items[start : start + page_size]


app = FastAPI()


@app.get("/offset", response_model=PaginatedResponse[Item])
def read_offset(paginator: Paginator = Depends()):
    sliced = _slice_items(SAMPLE_ITEMS, paginator.page, paginator.page_size)
    return paginate(sliced, total=len(SAMPLE_ITEMS), page=paginator.page, page_size=paginator.page_size)


@app.get("/cursor", response_model=PaginatedResponse[Item])
def read_cursor(params: CursorParams = Depends()):
    page = params.decoded_page
    page_size = params.decoded_page_size
    sliced = _slice_items(SAMPLE_ITEMS, page, page_size)
    return paginate(sliced, total=len(SAMPLE_ITEMS), page=page, page_size=page_size)


@app.get("/empty", response_model=PaginatedResponse[Item])
def read_empty(paginator: Paginator = Depends()):
    return paginate([], total=0, page=paginator.page, page_size=paginator.page_size)


client = TestClient(app)


class TestOffsetPagination:
    def test_first_page(self):
        response = client.get("/offset?page=1&page_size=10")
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 10
        assert data["total"] == 50
        assert data["page"] == 1
        assert data["page_size"] == 10
        assert data["total_pages"] == 5
        assert data["has_next"] is True
        assert data["has_previous"] is False

    def test_middle_page(self):
        response = client.get("/offset?page=3&page_size=10")
        data = response.json()
        assert len(data["items"]) == 10
        assert data["page"] == 3
        assert data["has_next"] is True
        assert data["has_previous"] is True

    def test_last_page(self):
        response = client.get("/offset?page=5&page_size=10")
        data = response.json()
        assert len(data["items"]) == 10
        assert data["has_next"] is False
        assert data["has_previous"] is True

    def test_partial_last_page(self):
        response = client.get("/offset?page=3&page_size=20")
        data = response.json()
        assert len(data["items"]) == 10
        assert data["total_pages"] == 3
        assert data["has_next"] is False

    def test_default_params(self):
        response = client.get("/offset")
        data = response.json()
        assert data["page"] == 1
        assert data["page_size"] == 20
        assert len(data["items"]) == 20

    def test_page_zero_rejected(self):
        response = client.get("/offset?page=0&page_size=10")
        assert response.status_code == 422

    def test_negative_page_rejected(self):
        response = client.get("/offset?page=-1&page_size=10")
        assert response.status_code == 422

    def test_page_size_zero_rejected(self):
        response = client.get("/offset?page=1&page_size=0")
        assert response.status_code == 422

    def test_page_size_exceeds_max_rejected(self):
        response = client.get("/offset?page=1&page_size=101")
        assert response.status_code == 422


class TestCursorPagination:
    def test_no_cursor_returns_first_page(self):
        response = client.get("/cursor?page_size=10")
        data = response.json()
        assert data["page"] == 1
        assert len(data["items"]) == 10
        assert data["has_next"] is True
        assert data["has_previous"] is False
        assert data["next_cursor"] is not None

    def test_follow_next_cursor(self):
        first = client.get("/cursor?page_size=10").json()
        cursor = first["next_cursor"]
        second = client.get(f"/cursor?cursor={cursor}").json()
        assert second["page"] == 2
        assert second["has_previous"] is True
        assert second["previous_cursor"] is not None

    def test_follow_previous_cursor_back(self):
        first = client.get("/cursor?page_size=10").json()
        cursor = first["next_cursor"]
        second = client.get(f"/cursor?cursor={cursor}").json()
        prev_cursor = second["previous_cursor"]
        back = client.get(f"/cursor?cursor={prev_cursor}").json()
        assert back["page"] == 1

    def test_invalid_cursor_defaults_to_page_one(self):
        response = client.get("/cursor?cursor=invalidcursor&page_size=10")
        data = response.json()
        assert data["page"] == 1

    def test_cursor_preserves_page_size(self):
        first = client.get("/cursor?page_size=15").json()
        cursor = first["next_cursor"]
        second = client.get(f"/cursor?cursor={cursor}").json()
        assert second["page_size"] == 15


class TestEmptyResults:
    def test_empty_items(self):
        response = client.get("/empty?page=1&page_size=10")
        data = response.json()
        assert data["items"] == []
        assert data["total"] == 0
        assert data["total_pages"] == 0
        assert data["has_next"] is False
        assert data["has_previous"] is False


class TestCursorEncoding:
    def test_encode_decode_roundtrip(self):
        cursor = _encode_cursor(3, 25)
        decoded = _decode_cursor(cursor)
        assert decoded["page"] == 3
        assert decoded["page_size"] == 25

    def test_decode_invalid_returns_defaults(self):
        decoded = _decode_cursor("not-valid-base64!!!")
        assert decoded["page"] == 1
        assert decoded["page_size"] == 20

    def test_decode_invalid_json(self):
        bad_json = base64.urlsafe_b64encode(b"not json").decode()
        decoded = _decode_cursor(bad_json)
        assert decoded["page"] == 1


class TestPaginatorProperties:
    def test_offset_calculation(self):
        p = Paginator(page=3, page_size=10)
        assert p.offset == 20

    def test_limit_equals_page_size(self):
        p = Paginator(page=1, page_size=25)
        assert p.limit == 25


class TestPaginateFunction:
    def test_paginate_helper(self):
        result = paginate(
            items=SAMPLE_ITEMS[:10],
            total=50,
            page=1,
            page_size=10,
        )
        assert isinstance(result, PaginatedResponse)
        assert result.page == 1
        assert result.total == 50
        assert result.has_next is True
