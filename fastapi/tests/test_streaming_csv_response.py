import asyncio

from fastapi import FastAPI
from fastapi.responses import StreamingCSVResponse
from fastapi.testclient import TestClient


async def iter_rows(rows):
    for row in rows:
        await asyncio.sleep(0)
        yield row


def test_streaming_csv_response_writes_headers_and_attachment_filename() -> None:
    app = FastAPI()

    @app.get("/report")
    async def report():
        return StreamingCSVResponse(
            iter_rows(
                [
                    {"id": 1, "name": "Alice"},
                    {"id": 2, "name": "Bob"},
                ]
            ),
            headers=["id", "name"],
            filename="users.csv",
        )

    client = TestClient(app)
    response = client.get("/report")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert response.headers["content-disposition"] == 'attachment; filename="users.csv"'
    assert response.text == "id,name\r\n1,Alice\r\n2,Bob\r\n"


def test_streaming_csv_response_escapes_commas_quotes_and_newlines() -> None:
    app = FastAPI()

    @app.get("/report")
    async def report():
        return StreamingCSVResponse(
            iter_rows([["ACME, Inc.", 'He said "hello"', "line\nbreak"]]),
            headers=["company", "quote", "notes"],
        )

    client = TestClient(app)
    response = client.get("/report")

    assert response.text == (
        'company,quote,notes\r\n"ACME, Inc.","He said ""hello""","line\nbreak"\r\n'
    )


def test_streaming_csv_response_supports_custom_delimiters() -> None:
    app = FastAPI()

    @app.get("/report")
    async def report():
        return StreamingCSVResponse(
            iter_rows([["one;two", "three"]]),
            headers=["left", "right"],
            delimiter=";",
        )

    client = TestClient(app)
    response = client.get("/report")

    assert response.text == 'left;right\r\n"one;two";three\r\n'


def test_streaming_csv_response_does_not_consume_rows_before_first_chunk() -> None:
    consumed: list[int] = []

    async def rows():
        for value in [1, 2]:
            consumed.append(value)
            yield [value]

    async def scenario() -> tuple[str, str, list[int]]:
        response = StreamingCSVResponse(rows(), headers=["value"])
        iterator = response.body_iterator.__aiter__()
        first_chunk = await anext(iterator)
        second_chunk = await anext(iterator)
        return first_chunk, second_chunk, consumed

    first_chunk, second_chunk, consumed_rows = asyncio.run(scenario())

    assert first_chunk == "value\r\n"
    assert second_chunk == "1\r\n"
    assert consumed_rows == [1]


def test_streaming_csv_response_respects_existing_content_disposition() -> None:
    async def rows():
        yield ["ok"]

    response = StreamingCSVResponse(
        rows(),
        filename="ignored.csv",
        response_headers={"Content-Disposition": "inline"},
    )

    assert response.headers["content-disposition"] == "inline"
