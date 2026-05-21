from collections.abc import AsyncIterator

from fastapi import FastAPI
from fastapi.responses import StreamingCSVResponse
from fastapi.testclient import TestClient


async def user_rows() -> AsyncIterator[dict[str, object]]:
    yield {"id": 1, "name": "Alice", "note": "plain"}
    yield {"id": 2, "name": "Bob, Jr.", "note": 'quote "inside"'}
    yield {"id": 3, "name": "Charlie", "note": "line\nbreak"}


app = FastAPI()


@app.get("/users.csv")
async def users_csv():
    return StreamingCSVResponse(
        user_rows(),
        headers=["id", "name", "note"],
        filename="users.csv",
    )


@app.get("/users-semicolon.csv")
async def users_semicolon_csv():
    return StreamingCSVResponse(
        [{"id": 1, "name": "Alice; admin"}],
        headers=["id", "name"],
        filename="users-semicolon.csv",
        delimiter=";",
    )


client = TestClient(app)


def test_streaming_csv_response_writes_headers_and_escapes_values():
    response = client.get("/users.csv")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert response.headers["content-disposition"] == 'attachment; filename="users.csv"'
    assert response.text == (
        "id,name,note\r\n"
        "1,Alice,plain\r\n"
        '2,"Bob, Jr.","quote ""inside"""\r\n'
        '3,Charlie,"line\nbreak"\r\n'
    )


def test_streaming_csv_response_supports_custom_delimiter():
    response = client.get("/users-semicolon.csv")

    assert response.status_code == 200
    assert response.headers["content-disposition"] == (
        'attachment; filename="users-semicolon.csv"'
    )
    assert response.text == 'id;name\r\n1;"Alice; admin"\r\n'


def test_streaming_csv_response_consumes_iterable_lazily():
    consumed: list[int] = []

    async def rows() -> AsyncIterator[list[int]]:
        for item in [1, 2, 3]:
            consumed.append(item)
            yield [item]

    response = StreamingCSVResponse(rows())

    assert consumed == []

    client = TestClient(FastAPI())
    client.app.get("/lazy.csv")(lambda: response)

    result = client.get("/lazy.csv")

    assert result.text == "1\r\n2\r\n3\r\n"
    assert consumed == [1, 2, 3]
