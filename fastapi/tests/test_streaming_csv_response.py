from collections.abc import AsyncIterator

import pytest
from fastapi import FastAPI
from fastapi.responses import StreamingCSVResponse
from fastapi.testclient import TestClient

app = FastAPI()


@app.get("/csv")
async def get_csv():
    async def rows() -> AsyncIterator[dict[str, object]]:
        yield {"id": 1, "name": "Alice"}
        yield {"id": 2, "name": "Bob"}

    return StreamingCSVResponse(rows(), headers=["id", "name"], filename="users.csv")


@app.get("/escaped")
async def get_escaped_csv():
    async def rows() -> AsyncIterator[list[str]]:
        yield ["with,comma", 'quote "inside"', "multi\nline"]

    return StreamingCSVResponse(rows(), headers=["one", "two", "three"])


@app.get("/semicolon")
async def get_semicolon_csv():
    async def rows() -> AsyncIterator[dict[str, str]]:
        yield {"name": "Alice;Admin", "city": "New York, NY"}

    return StreamingCSVResponse(rows(), headers=["name", "city"], delimiter=";")


@app.get("/sync")
async def get_sync_csv():
    return StreamingCSVResponse([(1, "Alice"), (2, "Bob")], headers=["id", "name"])


client = TestClient(app)


def test_streaming_csv_response_outputs_headers_and_rows():
    response = client.get("/csv")

    assert response.status_code == 200
    assert response.headers["content-type"] == "text/csv; charset=utf-8"
    assert response.headers["content-disposition"] == 'attachment; filename="users.csv"'
    assert response.content == b"id,name\r\n1,Alice\r\n2,Bob\r\n"


def test_streaming_csv_response_escapes_rfc4180_special_characters():
    response = client.get("/escaped")

    assert response.content == (
        b'one,two,three\r\n"with,comma","quote ""inside""","multi\nline"\r\n'
    )


def test_streaming_csv_response_uses_custom_delimiter():
    response = client.get("/semicolon")

    assert response.content == b'name;city\r\n"Alice;Admin";New York, NY\r\n'


def test_streaming_csv_response_accepts_sync_iterables():
    response = client.get("/sync")

    assert response.content == b"id,name\r\n1,Alice\r\n2,Bob\r\n"


def test_streaming_csv_response_rejects_invalid_delimiter():
    with pytest.raises(ValueError, match="CSV delimiter"):
        StreamingCSVResponse([], delimiter="::")
