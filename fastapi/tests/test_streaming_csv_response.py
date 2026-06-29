import pytest
from fastapi import FastAPI
from fastapi.responses import StreamingCSVResponse
from fastapi.testclient import TestClient


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def test_streaming_csv_response_writes_headers_and_escapes_values() -> None:
    app = FastAPI()

    async def rows():
        yield {"name": "Ada, Lovelace", "note": 'said "hello"'}
        yield {"name": "Grace\nHopper", "note": "compiler"}

    @app.get("/report")
    async def report():
        return StreamingCSVResponse(
            rows(),
            headers=["name", "note"],
            filename="people.csv",
        )

    response = TestClient(app).get("/report")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert response.headers["content-disposition"] == 'attachment; filename="people.csv"'
    assert response.text == (
        "name,note\r\n"
        '"Ada, Lovelace","said ""hello"""\r\n'
        '"Grace\nHopper",compiler\r\n'
    )


def test_streaming_csv_response_supports_custom_delimiter() -> None:
    app = FastAPI()

    async def rows():
        yield ["Ada; Lovelace", "math"]

    @app.get("/semicolon")
    async def semicolon():
        return StreamingCSVResponse(rows(), delimiter=";", headers=["name", "field"])

    response = TestClient(app).get("/semicolon")

    assert response.status_code == 200
    assert response.text == 'name;field\r\n"Ada; Lovelace";math\r\n'


def test_streaming_csv_response_uses_headers_for_mapping_order() -> None:
    app = FastAPI()

    async def rows():
        yield {"id": 1, "name": "Widget", "ignored": "not exported"}

    @app.get("/ordered")
    async def ordered():
        return StreamingCSVResponse(rows(), headers=["name", "id", "missing"])

    response = TestClient(app).get("/ordered")

    assert response.status_code == 200
    assert response.text == "name,id,missing\r\nWidget,1,\r\n"


def test_streaming_csv_response_supports_sync_rows_and_response_headers() -> None:
    response = StreamingCSVResponse(
        ([index, f"item-{index}"] for index in range(2)),
        headers=["id", "name"],
        response_headers={"x-report": "inventory"},
    )

    assert response.headers["x-report"] == "inventory"
    assert response.headers["content-disposition"] == 'attachment; filename="data.csv"'


@pytest.mark.anyio
async def test_streaming_csv_response_does_not_consume_rows_until_iterated() -> None:
    consumed: list[int] = []

    async def rows():
        consumed.append(1)
        yield [1]
        consumed.append(2)
        yield [2]

    response = StreamingCSVResponse(rows(), headers=["id"])

    assert consumed == []
    assert await anext(response.body_iterator) == "id\r\n"
    assert consumed == []
    assert await anext(response.body_iterator) == "1\r\n"
    assert consumed == [1]


def test_streaming_csv_response_rejects_invalid_delimiter() -> None:
    with pytest.raises(ValueError, match="single character"):
        StreamingCSVResponse([], delimiter="||")
