import pytest
from fastapi import FastAPI
from fastapi.responses import StreamingCSVResponse
from fastapi.testclient import TestClient


async def _rows():
    yield {"name": "Alice, A", "note": 'quote "here"'}
    yield {"name": "Bob", "note": "line\nbreak"}


def test_streaming_csv_response_headers_and_escaping() -> None:
    app = FastAPI()

    @app.get("/export")
    async def export() -> StreamingCSVResponse:
        return StreamingCSVResponse(
            _rows(),
            headers=["name", "note"],
            filename="report.csv",
        )

    response = TestClient(app).get("/export")

    assert response.status_code == 200
    assert response.headers["content-type"] == "text/csv; charset=utf-8"
    assert response.headers["content-disposition"] == (
        'attachment; filename="report.csv"'
    )
    assert response.text == (
        'name,note\r\n"Alice, A","quote ""here"""\r\nBob,"line\nbreak"\r\n'
    )


def test_streaming_csv_response_supports_custom_delimiter() -> None:
    app = FastAPI()

    @app.get("/export")
    async def export() -> StreamingCSVResponse:
        return StreamingCSVResponse(
            _rows(),
            headers=["name", "note"],
            delimiter=";",
        )

    response = TestClient(app).get("/export")

    assert response.text == (
        'name;note\r\nAlice, A;"quote ""here"""\r\nBob;"line\nbreak"\r\n'
    )


@pytest.mark.anyio
async def test_streaming_csv_response_consumes_rows_lazily() -> None:
    events: list[str] = []

    async def rows():
        events.append("first")
        yield ["first"]
        events.append("second")
        yield ["second"]

    response = StreamingCSVResponse(rows())

    assert events == []

    chunks = []
    async for chunk in response.body_iterator:
        chunks.append(chunk)
        if len(chunks) == 1:
            assert events == ["first"]

    assert chunks == ["first\r\n", "second\r\n"]
    assert events == ["first", "second"]


def test_streaming_csv_response_rejects_invalid_delimiter() -> None:
    with pytest.raises(ValueError, match="delimiter"):
        StreamingCSVResponse(_rows(), delimiter="||")


def test_streaming_csv_response_sanitizes_download_filename() -> None:
    response = StreamingCSVResponse(_rows(), filename='..\\bad\r\n"name.csv')

    assert response.headers["content-disposition"] == (
        'attachment; filename=".._badname.csv"'
    )
