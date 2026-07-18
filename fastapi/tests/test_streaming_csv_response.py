from collections.abc import AsyncGenerator

from fastapi import FastAPI
from fastapi.responses import StreamingCSVResponse
from fastapi.testclient import TestClient


async def _main_gen() -> AsyncGenerator[list[object], None]:
    yield ["Alice", "30", "Engineer"]
    yield ["Bob", "25", "Designer"]


async def _comma_gen() -> AsyncGenerator[list[object], None]:
    yield ['Smith, John', 'Notes, etc']


async def _quote_gen() -> AsyncGenerator[list[object], None]:
    yield ['He said "hello"', 'OK']


async def _tsv_gen() -> AsyncGenerator[list[object], None]:
    yield ["A", "B"]
    yield ["C", "D"]


async def _simple_gen() -> AsyncGenerator[list[object], None]:
    yield ["x", "y"]


app = FastAPI()


@app.get("/export")
async def export():
    return StreamingCSVResponse(rows=_main_gen(), headers=["Name", "Age", "Job"])


@app.get("/export-commas")
async def export_commas():
    return StreamingCSVResponse(rows=_comma_gen(), headers=["Name", "Notes"])


@app.get("/export-quotes")
async def export_quotes():
    return StreamingCSVResponse(rows=_quote_gen(), headers=["Quote", "Status"])


@app.get("/export-tsv")
async def export_tsv():
    return StreamingCSVResponse(
        rows=_tsv_gen(),
        headers=["X", "Y"],
        delimiter="|",
        filename="data.tsv",
    )


@app.get("/export-no-headers")
async def export_no_headers():
    return StreamingCSVResponse(rows=_simple_gen(), filename="raw.csv")


client = TestClient(app)


def test_csv_response_content_type():
    response = client.get("/export")
    assert response.status_code == 200
    assert response.headers["content-type"] == "text/csv"


def test_csv_response_disposition():
    response = client.get("/export")
    assert response.headers["content-disposition"] == 'attachment; filename="export.csv"'


def test_csv_response_headers_and_rows():
    response = client.get("/export")
    text = response.text
    lines = text.strip().split("\r\n")
    assert lines[0] == "Name,Age,Job"
    assert lines[1] == "Alice,30,Engineer"
    assert lines[2] == "Bob,25,Designer"


def test_csv_escapes_commas():
    response = client.get("/export-commas")
    text = response.text
    assert '"Smith, John"' in text
    assert '"Notes, etc"' in text


def test_csv_escapes_quotes():
    response = client.get("/export-quotes")
    text = response.text
    assert '"He said ""hello"""' in text


def test_csv_custom_delimiter():
    response = client.get("/export-tsv")
    text = response.text
    lines = text.strip().split("\r\n")
    assert lines[0] == "X|Y"
    assert lines[1] == "A|B"
    assert lines[2] == "C|D"


def test_csv_custom_filename():
    response = client.get("/export-tsv")
    assert response.headers["content-disposition"] == 'attachment; filename="data.tsv"'


def test_csv_no_headers():
    response = client.get("/export-no-headers")
    text = response.text
    assert text.strip() == "x,y"
