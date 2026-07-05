import asyncio

import pytest
from fastapi import FastAPI
from fastapi.responses import StreamingCSVResponse
from fastapi.testclient import TestClient


async def collect_body(response: StreamingCSVResponse) -> str:
    chunks = []
    async for chunk in response.body_iterator:
        if isinstance(chunk, str):
            chunk = chunk.encode(response.charset)
        chunks.append(chunk)
    return b"".join(chunks).decode(response.charset)


def test_streaming_csv_response_writes_headers_and_escapes_values():
    async def rows():
        yield {"name": "Ada, Lovelace", "note": 'quote "here"\nnext'}
        yield {"name": "Grace", "note": None}

    response = StreamingCSVResponse(
        rows(),
        headers=["name", "note"],
        filename="report.csv",
    )

    assert asyncio.run(collect_body(response)) == (
        'name,note\r\n"Ada, Lovelace","quote ""here""\nnext"\r\nGrace,\r\n'
    )
    assert response.headers["content-type"].startswith("text/csv")
    assert (
        response.headers["content-disposition"] == 'attachment; filename="report.csv"'
    )


def test_streaming_csv_response_supports_custom_delimiters():
    response = StreamingCSVResponse([["a;b", "c"]], delimiter=";")

    assert asyncio.run(collect_body(response)) == '"a;b";c\r\n'


def test_streaming_csv_response_supports_sync_iterable_rows():
    response = StreamingCSVResponse([("id", "name"), (1, "Ada")])

    assert asyncio.run(collect_body(response)) == "id,name\r\n1,Ada\r\n"


def test_streaming_csv_response_is_lazy():
    events = []

    async def rows():
        events.append("started")
        yield [1]
        events.append("continued")
        yield [2]

    response = StreamingCSVResponse(rows())

    assert events == []

    async def read_one_chunk() -> bytes:
        return await response.body_iterator.__anext__()

    assert asyncio.run(read_one_chunk()) == b"1\r\n"
    assert events == ["started"]


def test_streaming_csv_response_rejects_multi_character_delimiters():
    with pytest.raises(ValueError, match="one-character"):
        StreamingCSVResponse([], delimiter="||")


def test_streaming_csv_response_works_from_fastapi_app():
    app = FastAPI()

    @app.get("/exports")
    async def export_csv():
        return StreamingCSVResponse(
            [{"id": 1, "name": "Ada"}, {"id": 2, "name": "Grace"}],
            headers=["id", "name"],
            filename="users.csv",
        )

    client = TestClient(app)
    response = client.get("/exports")

    assert response.status_code == 200
    assert response.text == "id,name\r\n1,Ada\r\n2,Grace\r\n"
    assert response.headers["content-disposition"] == 'attachment; filename="users.csv"'
