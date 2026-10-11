import pytest
from fastapi import Depends, FastAPI
from fastapi.pagination import (
    DEFAULT_PAGE,
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    PaginatedResponse,
    Paginator,
    decode_cursor,
    encode_cursor,
    paginate,
    paginate_cursor,
    paginate_offset,
)
from fastapi.testclient import TestClient
from pydantic import BaseModel


class Item(BaseModel):
    id: int
    name: str


ITEMS = [Item(id=i, name=f"item-{i}") for i in range(1, 101)]


# ---------------------------------------------------------------- offset core

def test_offset_basic_window():
    res = paginate_offset(ITEMS, page=2, page_size=10)
    assert [x.id for x in res.items] == list(range(11, 21))
    assert res.total == 100
    assert res.page == 2
    assert res.page_size == 10
    assert res.total_pages == 10
    assert res.has_next is True
    assert res.has_previous is True


def test_offset_skip_and_limit():
    p = Paginator(page=4, page_size=25)
    assert p.offset == 75
    assert p.limit == 25


def test_offset_last_page_partial():
    res = paginate_offset(ITEMS, page=10, page_size=10)
    assert [x.id for x in res.items] == list(range(91, 101))
    assert res.has_next is False
    assert res.has_previous is True


def test_totals_accurate_with_partial_pages():
    res = paginate_offset(list(range(23)), page=1, page_size=10)
    assert res.total == 23
    assert res.total_pages == 3


def test_boundary_flags_first_page():
    res = paginate_offset(ITEMS, page=1, page_size=10)
    assert res.has_previous is False
    assert res.has_next is True


def test_boundary_flags_single_page():
    res = paginate_offset([1, 2, 3], page=1, page_size=10)
    assert res.has_next is False
    assert res.has_previous is False
    assert res.total_pages == 1


def test_beyond_last_page_returns_empty_window():
    res = paginate_offset(ITEMS, page=99, page_size=10)
    assert res.items == []
    assert res.has_next is False
    assert res.has_previous is True
    assert res.total == 100


def test_explicit_total_overrides_sequence_length():
    res = paginate_offset(ITEMS[:10], page=1, page_size=10, total=1000)
    assert res.total == 1000
    assert res.total_pages == 100
    assert res.has_next is True


# ---------------------------------------------------------------- edge cases

@pytest.mark.parametrize("page", [0, -1, -100])
def test_edge_page_zero_or_negative_clamped_to_one(page):
    res = paginate_offset(ITEMS, page=page, page_size=10)
    assert res.page == 1
    assert [x.id for x in res.items] == list(range(1, 11))


@pytest.mark.parametrize("size", [0, -5])
def test_edge_page_size_zero_or_negative_clamped(size):
    res = paginate_offset(ITEMS, page=1, page_size=size)
    assert res.page_size == 1
    assert len(res.items) == 1


def test_edge_page_size_clamped_to_max():
    res = paginate_offset(ITEMS, page=1, page_size=10_000)
    assert res.page_size == MAX_PAGE_SIZE


def test_edge_empty_results():
    res = paginate_offset([], page=1, page_size=10)
    assert res.items == []
    assert res.total == 0
    assert res.total_pages == 0
    assert res.has_next is False
    assert res.has_previous is False


def test_edge_empty_results_deep_page():
    res = paginate_offset([], page=7, page_size=10)
    assert res.items == []
    assert res.total_pages == 0
    assert res.has_previous is False


# ---------------------------------------------------------------- cursor core

def test_cursor_roundtrip_encoding():
    payload = {"id": 42, "ts": "2026-10-11"}
    enc = encode_cursor(payload)
    assert "=" not in enc  # URL-safe, unpadded
    assert decode_cursor(enc) == payload


def test_cursor_decode_none_and_invalid():
    assert decode_cursor(None) is None
    assert decode_cursor("") is None
    with pytest.raises(ValueError):
        decode_cursor("!!!not-base64!!!")


def test_cursor_pagination_forward_navigation():
    first = paginate_cursor(ITEMS, page_size=10)
    assert [x.id for x in first.items] == list(range(1, 11))
    assert first.next_cursor is not None
    assert first.previous_cursor is None
    assert first.has_next is True
    assert first.has_previous is False

    second = paginate_cursor(ITEMS, page_size=10, cursor=first.next_cursor)
    assert [x.id for x in second.items] == list(range(11, 21))
    assert second.has_previous is True
    # previous_cursor navigates back: decoding it and re-paginating returns page 1
    back = paginate_cursor(ITEMS, page_size=10, cursor=second.previous_cursor)
    assert [x.id for x in back.items] == list(range(1, 11))
    assert back.previous_cursor is None


def test_cursor_end_of_data_flags():
    last = None
    cur = None
    for _ in range(10):
        last = paginate_cursor(ITEMS, page_size=10, cursor=cur)
        cur = last.next_cursor
    assert last.next_cursor is None
    assert last.has_next is False
    assert [x.id for x in last.items] == list(range(91, 101))


def test_cursor_empty_results():
    res = paginate_cursor([], page_size=10)
    assert res.items == []
    assert res.total == 0
    assert res.has_next is False
    assert res.next_cursor is None


def test_cursor_preserves_keyset_payload():
    start = encode_cursor({"id": 55})
    res = paginate_cursor(ITEMS, page_size=5, cursor=start)
    nxt = decode_cursor(res.next_cursor)
    assert nxt["id"] == 55  # caller keyset preserved across pages


# ---------------------------------------------------------------- generic model

def test_paginated_response_generic_any_model():
    class Secret(BaseModel):
        token: str

    res = PaginatedResponse[Secret](
        items=[Secret(token="x")], total=1, page=1, page_size=10, total_pages=1
    )
    assert res.items[0].token == "x"


def test_paginated_response_serializes_items():
    res = paginate_offset(ITEMS, page=1, page_size=2)
    data = res.model_dump()
    assert data["items"] == [{"id": 1, "name": "item-1"}, {"id": 2, "name": "item-2"}]


# ---------------------------------------------------------------- dependency wiring

def test_paginate_dependency_defaults():
    app = FastAPI()

    @app.get("/items", response_model=PaginatedResponse[Item])
    def list_items(pager: Paginator = Depends(paginate)):
        return pager.paginate(ITEMS)

    client = TestClient(app)
    r = client.get("/items")
    assert r.status_code == 200
    body = r.json()
    assert body["page"] == DEFAULT_PAGE
    assert body["page_size"] == DEFAULT_PAGE_SIZE
    assert len(body["items"]) == DEFAULT_PAGE_SIZE
    assert body["total"] == 100
    assert body["total_pages"] == 4
    assert body["has_next"] is True


def test_paginate_dependency_custom_params():
    app = FastAPI()

    @app.get("/items", response_model=PaginatedResponse[Item])
    def list_items(pager: Paginator = Depends(paginate)):
        return pager.paginate(ITEMS)

    client = TestClient(app)
    r = client.get("/items?page=3&page_size=5")
    body = r.json()
    assert [x["id"] for x in body["items"]] == list(range(11, 16))
    assert body["has_previous"] is True
    assert body["has_next"] is True


def test_paginate_dependency_rejects_bad_params():
    app = FastAPI()

    @app.get("/items", response_model=PaginatedResponse[Item])
    def list_items(pager: Paginator = Depends(paginate)):
        return pager.paginate(ITEMS)

    client = TestClient(app)
    assert client.get("/items?page=0").status_code == 422
    assert client.get("/items?page_size=0").status_code == 422
    assert client.get("/items?page_size=99999").status_code == 422


def test_paginator_cursor_dependency():
    app = FastAPI()

    @app.get("/items", response_model=PaginatedResponse[Item])
    def list_items(pager: Paginator = Depends(paginate), cursor: str | None = None):
        return pager.paginate_cursor(ITEMS, cursor=cursor)

    client = TestClient(app)
    first = client.get("/items?page_size=7").json()
    second = client.get(f"/items?page_size=7&cursor={first['next_cursor']}").json()
    assert [x["id"] for x in first["items"]] == list(range(1, 8))
    assert [x["id"] for x in second["items"]] == list(range(8, 15))
