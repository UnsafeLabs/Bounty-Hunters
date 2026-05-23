from collections.abc import AsyncIterator

from fastapi import FastAPI
from fastapi.responses import StreamingCSVResponse
from fastapi.testclient import TestClient


async def row_stream() -> AsyncIterator[dict[str, str]]:
    yield {"name": "Alice", "note": "hello, world"}
    yield {"name": "Bob", "note": 'quote "here"'}
    yield {"name": "Carol", "note": "two\nlines"}


def test_streaming_csv_response_headers_filename_and_escaping():
    app = FastAPI()

    @app.get("/export")
    def export():
        return StreamingCSVResponse(
            row_stream(),
            headers=["name", "note"],
            filename="users.csv",
        )

    response = TestClient(app).get("/export")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert response.headers["content-disposition"] == (
        'attachment; filename="users.csv"'
    )
    assert response.text == (
        "name,note\r\n"
        'Alice,"hello, world"\r\n'
        'Bob,"quote ""here"""\r\n'
        'Carol,"two\nlines"\r\n'
    )


def test_streaming_csv_response_custom_delimiter():
    app = FastAPI()

    async def rows() -> AsyncIterator[list[str]]:
        yield ["alpha", "one;two"]

    @app.get("/export")
    def export():
        return StreamingCSVResponse(
            rows(),
            headers=["name", "value"],
            delimiter=";",
        )

    response = TestClient(app).get("/export")

    assert response.text == 'name;value\r\nalpha;"one;two"\r\n'


def test_streaming_csv_response_without_headers_uses_row_values():
    app = FastAPI()

    async def rows() -> AsyncIterator[dict[str, str]]:
        yield {"name": "Alice", "note": "hello"}

    @app.get("/export")
    def export():
        return StreamingCSVResponse(rows())

    response = TestClient(app).get("/export")

    assert response.text == "Alice,hello\r\n"
