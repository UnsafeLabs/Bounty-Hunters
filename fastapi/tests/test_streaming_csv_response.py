from collections.abc import AsyncIterator

import pytest
from fastapi import FastAPI
from fastapi.responses import StreamingCSVResponse
from fastapi.testclient import TestClient


def test_streaming_csv_response_headers_and_escaping():
    app = FastAPI()

    async def rows() -> AsyncIterator[dict[str, str]]:
        yield {"name": "Alice", "note": "hello, world"}
        yield {"name": 'Bob "B"', "note": "line\nbreak"}

    @app.get("/report")
    async def report():
        return StreamingCSVResponse(
            rows(), headers=["name", "note"], filename="report.csv"
        )

    response = TestClient(app).get("/report")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert response.headers["content-disposition"] == (
        'attachment; filename="report.csv"'
    )
    assert response.text == (
        'name,note\r\nAlice,"hello, world"\r\n"Bob ""B""","line\nbreak"\r\n'
    )


def test_streaming_csv_response_custom_delimiter():
    app = FastAPI()

    async def rows() -> AsyncIterator[list[str]]:
        yield ["left", "right;side"]
        yield ["quote", 'a"b']

    @app.get("/report")
    async def report():
        return StreamingCSVResponse(rows(), delimiter=";")

    response = TestClient(app).get("/report")
    assert response.status_code == 200
    assert response.text == 'left;"right;side"\r\nquote;"a""b"\r\n'


def test_streaming_csv_response_mapping_without_headers():
    app = FastAPI()

    async def rows() -> AsyncIterator[dict[str, object]]:
        yield {"name": "Alice", "age": 30}

    @app.get("/report")
    async def report():
        return StreamingCSVResponse(rows())

    response = TestClient(app).get("/report")
    assert response.status_code == 200
    assert response.text == "Alice,30\r\n"


def test_streaming_csv_response_sanitizes_filename():
    response = StreamingCSVResponse(_empty_rows())
    assert response.headers["content-disposition"] == (
        'attachment; filename="export.csv"'
    )

    response = StreamingCSVResponse(_empty_rows(), filename='bad"/name\r\n.csv')
    assert response.headers["content-disposition"] == (
        'attachment; filename="bad__name__.csv"'
    )


@pytest.mark.anyio
async def test_streaming_csv_response_yields_rows_lazily():
    seen: list[str] = []

    async def rows() -> AsyncIterator[list[str]]:
        seen.append("first")
        yield ["Alice"]
        seen.append("second")
        yield ["Bob"]

    response = StreamingCSVResponse(rows(), headers=["name"])
    assert seen == []

    first = await anext(response.body_iterator)
    assert first == "name\r\n"
    assert seen == []

    second = await anext(response.body_iterator)
    assert second == "Alice\r\n"
    assert seen == ["first"]

    third = await anext(response.body_iterator)
    assert third == "Bob\r\n"
    assert seen == ["first", "second"]

    with pytest.raises(StopAsyncIteration):
        await anext(response.body_iterator)


async def _empty_rows() -> AsyncIterator[list[str]]:
    if False:  # pragma: nocover
        yield []
