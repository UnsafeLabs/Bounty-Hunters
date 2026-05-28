from __future__ import annotations

import pytest
from starlette.testclient import TestClient

from fastapi import FastAPI
from fastapi.responses import StreamingCSVResponse


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _async_rows(data):
    """Helper async generator that yields rows."""
    for row in data:
        yield row


def _make_app(rows, **kwargs):
    app = FastAPI()

    @app.get("/export")
    async def export():
        return StreamingCSVResponse(_async_rows(rows), **kwargs)

    return app


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestStreamingCSVResponse:
    def test_basic_rows(self):
        app = _make_app([["Alice", 30], ["Bob", 25]])
        client = TestClient(app)

        resp = client.get("/export")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "text/csv; charset=utf-8"
        assert "attachment" in resp.headers.get("content-disposition", "")
        lines = resp.text.strip().split("\r\n")
        assert lines[0] == "Alice,30"
        assert lines[1] == "Bob,25"

    def test_with_headers(self):
        app = _make_app(
            [["Alice", 30], ["Bob", 25]],
            headers=["Name", "Age"],
        )
        client = TestClient(app)

        resp = client.get("/export")
        assert resp.status_code == 200
        lines = resp.text.strip().split("\r\n")
        assert lines[0] == "Name,Age"
        assert lines[1] == "Alice,30"
        assert lines[2] == "Bob,25"

    def test_custom_filename(self):
        app = _make_app([["a"]], filename="data.csv")
        client = TestClient(app)

        resp = client.get("/export")
        assert 'filename="data.csv"' in resp.headers["content-disposition"]

    def test_default_filename(self):
        app = _make_app([["a"]])
        client = TestClient(app)

        resp = client.get("/export")
        assert 'filename="export.csv"' in resp.headers["content-disposition"]

    def test_escape_comma_in_value(self):
        app = _make_app([["Smith, John", 30]])
        client = TestClient(app)

        resp = client.get("/export")
        lines = resp.text.strip().split("\r\n")
        assert lines[0] == '"Smith, John",30'

    def test_escape_double_quote_in_value(self):
        app = _make_app([['He said "hello"', 30]])
        client = TestClient(app)

        resp = client.get("/export")
        lines = resp.text.strip().split("\r\n")
        assert lines[0] == '"He said ""hello""",30'

    def test_escape_newline_in_value(self):
        app = _make_app([["Line1\nLine2", 30]])
        client = TestClient(app)

        resp = client.get("/export")
        lines = resp.text.strip().split("\r\n")
        assert lines[0] == '"Line1\nLine2",30'

    def test_custom_delimiter(self):
        app = _make_app(
            [["Alice", 30], ["Bob", 25]],
            headers=["Name", "Age"],
            delimiter=";",
        )
        client = TestClient(app)

        resp = client.get("/export")
        lines = resp.text.strip().split("\r\n")
        assert lines[0] == "Name;Age"
        assert lines[1] == "Alice;30"

    def test_empty_rows(self):
        app = _make_app([], headers=["A", "B"])
        client = TestClient(app)

        resp = client.get("/export")
        assert resp.status_code == 200
        lines = resp.text.strip().split("\r\n")
        assert lines == ["A,B"]

    def test_no_headers(self):
        app = _make_app([["x", "y"]])
        client = TestClient(app)

        resp = client.get("/export")
        lines = resp.text.strip().split("\r\n")
        assert lines[0] == "x,y"
        assert len(lines) == 1

    def test_numeric_values(self):
        app = _make_app([[1, 2.5, True]])
        client = TestClient(app)

        resp = client.get("/export")
        lines = resp.text.strip().split("\r\n")
        assert lines[0] == "1,2.5,True"

    def test_media_type(self):
        app = _make_app([["a"]])
        client = TestClient(app)

        resp = client.get("/export")
        assert "text/csv" in resp.headers["content-type"]
