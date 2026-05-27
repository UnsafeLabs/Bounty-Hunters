import io
from pathlib import Path

import pytest
from fastapi import FastAPI, UploadFile
from fastapi.datastructures import Default
from fastapi.testclient import TestClient


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


def test_upload_file_validate_max_size():
    """Test that validate() rejects files exceeding max_size."""
    from starlette.exceptions import HTTPException

    stream = io.BytesIO(b"x" * 1000)
    file = UploadFile(filename="test.txt", file=stream, size=1000, max_size=500)
    with pytest.raises(HTTPException) as exc_info:
        file.validate()
    assert exc_info.value.status_code == 400
    assert "File size exceeds maximum allowed size" in str(exc_info.value.detail)


def test_upload_file_validate_max_size_ok():
    """Test that validate() passes when size is within limits."""
    stream = io.BytesIO(b"x" * 100)
    file = UploadFile(filename="test.txt", file=stream, size=100, max_size=500)
    result = file.validate()
    assert result is file  # returns self for chaining


def test_upload_file_validate_content_type_allowed():
    """Test that validate() passes for an allowed content type."""
    from starlette.datastructures import Headers

    headers = Headers({"content-type": "image/png"})
    stream = io.BytesIO(b"fake png data")
    file = UploadFile(
        filename="img.png", file=stream, size=12, headers=headers,
        allowed_content_types=["image/png", "image/jpeg"],
    )
    result = file.validate()
    assert result is file


def test_upload_file_validate_content_type_blocked():
    """Test that validate() rejects a disallowed content type."""
    from starlette.exceptions import HTTPException
    from starlette.datastructures import Headers

    headers = Headers({"content-type": "text/html"})
    stream = io.BytesIO(b"<html></html>")
    file = UploadFile(
        filename="doc.html", file=stream, size=15, headers=headers,
        allowed_content_types=["image/png", "application/pdf"],
    )
    with pytest.raises(HTTPException) as exc_info:
        file.validate()
    assert exc_info.value.status_code == 415
    assert "Content type" in str(exc_info.value.detail)


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
