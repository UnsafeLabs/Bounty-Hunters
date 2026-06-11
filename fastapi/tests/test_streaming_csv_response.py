from collections.abc import AsyncIterator

import pytest
from fastapi import FastAPI
from fastapi.responses import StreamingCSVResponse
from fastapi.testclient import TestClient


def test_streaming_csv_response_writes_headers_and_escapes_values() -> None:
    app = FastAPI()

    async def rows() -> AsyncIterator[dict[str, str]]:
        yield {"name": "Ada", "note": "comma, inside"}
        yield {"name": 'Grace "G"', "note": "line\nbreak"}

    @app.get("/export")
    def export() -> StreamingCSVResponse:
        return StreamingCSVResponse(
            rows(),
            headers=["name", "note"],
            filename="people.csv",
        )

    response = TestClient(app).get("/export")

    assert response.headers["content-type"] == "text/csv; charset=utf-8"
    assert response.headers["content-disposition"] == (
        'attachment; filename="people.csv"'
    )
    assert response.content == (
        b"name,note\r\n"
        b'Ada,"comma, inside"\r\n'
        b'"Grace ""G""","line\nbreak"\r\n'
    )


def test_streaming_csv_response_supports_custom_delimiter() -> None:
    app = FastAPI()

    @app.get("/export")
    def export() -> StreamingCSVResponse:
        return StreamingCSVResponse(
            [["Ada", "math;logic"], ["Grace", "compiler"]],
            headers=["name", "field"],
            delimiter=";",
        )

    response = TestClient(app).get("/export")

    assert response.text == 'name;field\r\nAda;"math;logic"\r\nGrace;compiler\r\n'


def test_streaming_csv_response_works_as_response_class() -> None:
    app = FastAPI()

    @app.get("/export", response_class=StreamingCSVResponse)
    async def export() -> AsyncIterator[list[str]]:
        yield ["Ada", "math"]
        yield ["Grace", "compiler"]

    response = TestClient(app).get("/export")

    assert response.headers["content-disposition"] == (
        'attachment; filename="export.csv"'
    )
    assert response.text == "Ada,math\r\nGrace,compiler\r\n"


def test_streaming_csv_response_does_not_consume_generator_up_front() -> None:
    consumed: list[int] = []

    async def rows() -> AsyncIterator[list[int]]:
        for value in range(3):
            consumed.append(value)
            yield [value]

    async def run() -> None:
        response = StreamingCSVResponse(rows())
        first_chunk = await response.body_iterator.__anext__()
        assert first_chunk == b"0\r\n"
        assert consumed == [0]
        await response.body_iterator.aclose()

    import asyncio

    asyncio.run(run())


def test_streaming_csv_response_accepts_http_headers_mapping() -> None:
    response = StreamingCSVResponse(
        [["Ada"]],
        headers={"x-export": "people"},
        response_headers={"x-owner": "analytics"},
    )

    assert response.headers["x-export"] == "people"
    assert response.headers["x-owner"] == "analytics"


def test_streaming_csv_response_rejects_invalid_delimiter() -> None:
    with pytest.raises(ValueError, match="delimiter"):
        StreamingCSVResponse([["Ada"]], delimiter="::")
