from fastapi import FastAPI
from fastapi.responses import StreamingCSVResponse
from fastapi.testclient import TestClient


def test_streaming_csv_response_writes_headers_and_escapes_values():
    app = FastAPI()

    async def rows():
        yield {"name": "Alice", "note": "hello, world"}
        yield {"name": "Bob", "note": 'He said "hi"'}
        yield {"name": "Carol", "note": "line\nbreak"}

    @app.get("/report")
    async def report():
        return StreamingCSVResponse(
            rows(),
            headers=["name", "note"],
            filename="report.csv",
        )

    response = TestClient(app).get("/report")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert (
        response.headers["content-disposition"] == 'attachment; filename="report.csv"'
    )
    assert response.content == (
        b"name,note\r\n"
        b'Alice,"hello, world"\r\n'
        b'Bob,"He said ""hi"""\r\n'
        b'Carol,"line\nbreak"\r\n'
    )


def test_streaming_csv_response_supports_custom_delimiter():
    app = FastAPI()

    @app.get("/semicolon")
    async def semicolon():
        return StreamingCSVResponse(
            [["alice", "uses;delimiter"], ["bob", "plain"]],
            headers=["name", "note"],
            delimiter=";",
        )

    response = TestClient(app).get("/semicolon")

    assert response.content == (b'name;note\r\nalice;"uses;delimiter"\r\nbob;plain\r\n')


def test_streaming_csv_response_encodes_attachment_filename():
    response = StreamingCSVResponse(
        [],
        filename="sales report.csv",
    )

    assert (
        response.headers["content-disposition"]
        == "attachment; filename*=utf-8''sales%20report.csv"
    )


def test_streaming_csv_response_is_lazy():
    app = FastAPI()
    consumed: list[str] = []

    async def rows():
        consumed.append("row")
        yield ["Alice"]

    @app.get("/lazy")
    async def lazy():
        response = StreamingCSVResponse(rows(), headers=["name"])
        assert consumed == []
        return response

    response = TestClient(app).get("/lazy")

    assert response.content == b"name\r\nAlice\r\n"
    assert consumed == ["row"]


def test_streaming_csv_response_maps_missing_dict_values_to_empty_cells():
    app = FastAPI()

    @app.get("/missing")
    async def missing():
        return StreamingCSVResponse(
            [{"name": "Alice"}],
            headers=["name", "email"],
        )

    response = TestClient(app).get("/missing")

    assert response.content == b"name,email\r\nAlice,\r\n"
