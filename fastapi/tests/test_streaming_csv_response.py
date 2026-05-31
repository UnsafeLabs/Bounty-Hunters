import pytest
from fastapi import FastAPI
from fastapi.responses import StreamingCSVResponse
from fastapi.testclient import TestClient


async def _empty_rows():
    if False:
        yield []


def test_streaming_csv_response_headers_and_attachment():
    app = FastAPI()

    async def rows():
        yield {"name": "Alice", "note": "hello"}
        yield {"name": "Bob", "note": "bye"}

    @app.get("/export")
    def export():
        return StreamingCSVResponse(
            rows(), headers=["name", "note"], filename="users.csv"
        )

    response = TestClient(app).get("/export")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert 'filename="users.csv"' in response.headers["content-disposition"]
    assert response.text == "name,note\r\nAlice,hello\r\nBob,bye\r\n"


@pytest.mark.anyio
async def test_streaming_csv_response_escapes_special_values_async():
    async def rows():
        yield ["a,b", 'quote "inside"', "line\nbreak"]

    response = StreamingCSVResponse(rows())

    body = b""
    async for chunk in response.body_iterator:
        body += chunk

    assert body.decode() == '"a,b","quote ""inside""","line\nbreak"\r\n'


def test_streaming_csv_response_custom_delimiter():
    app = FastAPI()

    async def rows():
        yield ["alpha", "uses;delimiter"]

    @app.get("/export")
    def export():
        return StreamingCSVResponse(rows(), delimiter=";")

    response = TestClient(app).get("/export")

    assert response.text == 'alpha;"uses;delimiter"\r\n'


@pytest.mark.anyio
async def test_streaming_csv_response_streams_lazily():
    events: list[str] = []

    async def rows():
        for value in ["first", "second"]:
            events.append(value)
            yield [value]

    response = StreamingCSVResponse(rows(), headers=["name"])
    iterator = response.body_iterator

    assert events == []
    assert await anext(iterator) == b"name\r\n"
    assert events == []
    assert await anext(iterator) == b"first\r\n"
    assert events == ["first"]
    assert await anext(iterator) == b"second\r\n"
    assert events == ["first", "second"]
    with pytest.raises(StopAsyncIteration):
        await anext(iterator)


def test_streaming_csv_response_mapping_without_headers_uses_values():
    app = FastAPI()

    async def rows():
        yield {"name": "Alice", "note": None}

    @app.get("/export")
    def export():
        return StreamingCSVResponse(rows())

    response = TestClient(app).get("/export")

    assert response.text == "Alice,\r\n"


def test_streaming_csv_response_sanitizes_filename_header():
    response = StreamingCSVResponse(_empty_rows(), filename='unsafe/name"\r\n.csv')

    assert (
        response.headers["content-disposition"]
        == 'attachment; filename="unsafe_name___.csv"; '
        "filename*=utf-8''unsafe%2Fname%22%0D%0A.csv"
    )


def test_streaming_csv_response_rejects_multi_character_delimiter():
    with pytest.raises(ValueError, match="delimiter must be a single character"):
        StreamingCSVResponse(_empty_rows(), delimiter="::")
