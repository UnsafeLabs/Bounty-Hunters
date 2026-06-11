from collections.abc import AsyncIterator

from fastapi import FastAPI
from fastapi.responses import StreamingCSVResponse
from fastapi.testclient import TestClient


def test_streaming_csv_response_writes_headers_and_escapes_values() -> None:
    app = FastAPI()

    async def rows() -> AsyncIterator[dict[str, str]]:
        yield {"name": "Ada", "note": "comma, inside"}
        yield {"name": 'Grace "G"', "note": "line\nbreak"}

    @app.get("/export")
    def export():
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
        b'name,note\r\n'
        b'Ada,"comma, inside"\r\n'
        b'"Grace ""G""","line\nbreak"\r\n'
    )


def test_streaming_csv_response_supports_custom_delimiter() -> None:
    app = FastAPI()

    @app.get("/export")
    def export():
        return StreamingCSVResponse(
            [["Ada", "math"], ["Grace", "compiler"]],
            headers=["name", "field"],
            delimiter=";",
        )

    response = TestClient(app).get("/export")

    assert response.text == "name;field\r\nAda;math\r\nGrace;compiler\r\n"


def test_streaming_csv_response_streams_generator_rows() -> None:
    consumed: list[int] = []

    async def rows() -> AsyncIterator[list[int]]:
        for value in range(3):
            consumed.append(value)
            yield [value]

    app = FastAPI()

    @app.get("/export")
    def export():
        return StreamingCSVResponse(rows())

    client_response = TestClient(app).get("/export")

    assert client_response.text == "0\r\n1\r\n2\r\n"
    assert consumed == [0, 1, 2]
