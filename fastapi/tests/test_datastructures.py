import io
from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.datastructures import Default
from fastapi.testclient import TestClient
from starlette.datastructures import Headers


def test_upload_file_invalid_pydantic_v2():
    with pytest.raises(ValueError):
        UploadFile._validate("not a Starlette UploadFile", {})


def test_default_placeholder_equals():
    placeholder_1 = Default("a")
    placeholder_2 = Default("a")
    assert placeholder_1 == placeholder_2
    assert placeholder_1.value == placeholder_2.value


def test_default_placeholder_bool():
    placeholder_a = Default("a")
    placeholder_b = Default("")
    assert placeholder_a
    assert not placeholder_b


def test_upload_file_is_closed(tmp_path: Path):
    path = tmp_path / "test.txt"
    path.write_bytes(b"<file content>")
    app = FastAPI()

    testing_file_store: list[UploadFile] = []

    @app.post("/uploadfile/")
    def create_upload_file(file: UploadFile):
        testing_file_store.append(file)
        return {"filename": file.filename}

    client = TestClient(app)
    with path.open("rb") as file:
        response = client.post("/uploadfile/", files={"file": file})
    assert response.status_code == 200, response.text
    assert response.json() == {"filename": "test.txt"}

    assert testing_file_store
    assert testing_file_store[0].file.closed


# For UploadFile coverage, segments copied from Starlette tests


@pytest.mark.anyio
async def test_upload_file():
    stream = io.BytesIO(b"data")
    file = UploadFile(filename="file", file=stream, size=4)
    assert await file.read() == b"data"
    assert file.size == 4
    await file.write(b" and more data!")
    assert await file.read() == b""
    assert file.size == 19
    await file.seek(0)
    assert await file.read() == b"data and more data!"
    await file.close()


@pytest.mark.anyio
async def test_upload_file_validate_returns_metadata():
    stream = io.BytesIO(b"data")
    file = UploadFile(
        filename="file.txt",
        file=stream,
        headers=Headers({"content-type": "text/plain"}),
        max_size=10,
        allowed_content_types=["text/plain"],
    )

    result = await file.validate()

    assert result.is_valid is True
    assert result.file_size == 4
    assert result.content_type == "text/plain"
    assert await file.read() == b"data"


@pytest.mark.anyio
async def test_upload_file_validate_skips_optional_constraints():
    stream = io.BytesIO(b"data")
    file = UploadFile(
        filename="file.bin",
        file=stream,
        headers=Headers({"content-type": "application/octet-stream"}),
    )

    result = await file.validate()

    assert result.is_valid is True
    assert result.file_size == 4
    assert result.content_type == "application/octet-stream"


@pytest.mark.anyio
async def test_upload_file_validate_rejects_oversized_file():
    stream = io.BytesIO(b"large data")
    file = UploadFile(filename="file", file=stream, max_size=4)

    with pytest.raises(HTTPException) as exc_info:
        await file.validate()

    assert exc_info.value.status_code == 413


@pytest.mark.anyio
async def test_upload_file_read_rejects_oversized_file_before_processing():
    stream = io.BytesIO(b"large data")
    file = UploadFile(filename="file", file=stream, size=10, max_size=4)

    with pytest.raises(HTTPException) as exc_info:
        await file.read()

    assert exc_info.value.status_code == 413


@pytest.mark.anyio
async def test_upload_file_validate_rejects_disallowed_content_type():
    stream = io.BytesIO(b"data")
    file = UploadFile(
        filename="file.json",
        file=stream,
        headers=Headers({"content-type": "application/json"}),
        allowed_content_types=["text/plain"],
    )

    with pytest.raises(HTTPException) as exc_info:
        await file.validate()

    assert exc_info.value.status_code == 415
