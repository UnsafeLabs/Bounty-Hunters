"""Tests for fastapi.pagination (issue #802) — importlib load, no full install required."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

_PATH = Path(__file__).resolve().parents[1] / "fastapi" / "pagination.py"


def _load():
    name = "fastapi_pagination_local"
    if name in sys.modules:
        del sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, _PATH)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    # Stub minimal fastapi if missing so module loads
    if "fastapi" not in sys.modules:
        import types

        fake = types.ModuleType("fastapi")
        fake.Depends = lambda x: x
        fake.HTTPException = Exception
        fake.Query = lambda *a, **k: None
        sys.modules["fastapi"] = fake
    # pydantic is required
    spec.loader.exec_module(mod)
    return mod


def test_offset_skip_limit():
    mod = _load()
    p = mod.Paginator(page=3, page_size=10)
    assert p.offset == 20
    assert p.limit == 10


def test_page_totals_and_flags():
    mod = _load()
    items = list(range(25))
    r = mod.Paginator(page=1, page_size=10).slice(items)
    assert r.total == 25
    assert r.total_pages == 3
    assert r.items == list(range(10))
    assert r.has_next is True
    assert r.has_previous is False

    r2 = mod.Paginator(page=3, page_size=10).slice(items)
    assert r2.items == list(range(20, 25))
    assert r2.has_next is False
    assert r2.has_previous is True


def test_empty_results():
    mod = _load()
    r = mod.Paginator(page=1, page_size=10).slice([])
    assert r.total == 0
    assert r.total_pages == 0
    assert r.items == []
    assert r.has_next is False
    assert r.has_previous is False


def test_edge_page_zero_and_negative():
    mod = _load()
    p = mod.Paginator(page=0, page_size=10)
    assert p.page == 1
    p2 = mod.Paginator(page=-5, page_size=10)
    assert p2.page == 1


def test_edge_page_size_zero():
    mod = _load()
    p = mod.Paginator(page=1, page_size=0)
    assert p.page_size == 20


def test_cursor_roundtrip_next_prev():
    mod = _load()
    items = list(range(30))
    r = mod.Paginator(page=2, page_size=10).slice(items)
    assert r.next_cursor and r.previous_cursor
    # follow next cursor
    nxt = mod.Paginator(page=1, page_size=10, cursor=r.next_cursor).slice(items)
    assert nxt.page == 3
    assert nxt.items == list(range(20, 30))
    prev = mod.Paginator(page=1, page_size=10, cursor=r.previous_cursor).slice(items)
    assert prev.page == 1
    assert prev.items == list(range(10))


def test_invalid_cursor_raises():
    mod = _load()
    try:
        mod.Paginator(cursor="%%%not-base64%%%")
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_paginated_response_generic_items():
    mod = _load()
    from pydantic import BaseModel

    class Item(BaseModel):
        id: int
        name: str

    data = [Item(id=i, name=f"n{i}") for i in range(5)]
    r = mod.Paginator(page=1, page_size=2).slice(data)
    assert len(r.items) == 2
    assert r.items[0].name == "n0"
    assert r.total == 5
    assert r.has_next is True


def test_from_window_cursor_after():
    mod = _load()

    class Row:
        def __init__(self, id):
            self.id = id

    window = [Row(11), Row(12)]
    r = mod.Paginator(page=2, page_size=2).from_window(window, total=6, cursor_key="id")
    assert r.has_next is True
    assert r.next_cursor is not None
    data = mod._decode_cursor(r.next_cursor)
    assert data["after"] == 12
    assert data["page"] == 3


def test_paginate_helper():
    mod = _load()
    p = mod.paginate(page=2, page_size=5)
    assert p.offset == 5
    assert p.limit == 5


def test_get_pagination_params():
    mod = _load()
    params = mod.get_pagination_params(page=0, page_size=0)
    assert params.page == 1
    assert params.page_size == 20
    assert params.offset == 0


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
    print("ALL PASSED")
