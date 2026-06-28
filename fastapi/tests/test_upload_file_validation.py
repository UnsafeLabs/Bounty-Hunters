import io

import pytest
from fastapi import FastAPI, UploadFile
from fastapi.exceptions import HTTPException
from fastapi.testclient import TestClient
from starlette.datastructures import Headers


@pytest.mark.anyio
async def test_upload_file_validate_rejects_large_file():
    upload = UploadFile(
        file=io.BytesIO(b"larger than allowed"),
        filename="large.txt",
        size=19,
        max_size=8,
    )

    with pytest.raises(HTTPException) as exc_info:
        await upload.validate()

    assert exc_info.value.status_code == 413


@pytest.mark.anyio
async def test_upload_file_read_rejects_disallowed_content_type():
    upload = UploadFile(
        file=io.BytesIO(b"not json"),
        filename="data.txt",
        headers=Headers({"content-type": "text/plain"}),
        allowed_content_types=["application/json"],
    )

    with pytest.raises(HTTPException) as exc_info:
        await upload.read()

    assert exc_info.value.status_code == 415


@pytest.mark.anyio
async def test_upload_file_validate_allows_unconfigured_constraints():
    upload = UploadFile(
        file=io.BytesIO(b"unrestricted"),
        filename="any.bin",
        headers=Headers({"content-type": "application/octet-stream"}),
    )

    result = await upload.validate()

    assert result.is_valid is True
    assert result.file_size == 12
    assert result.content_type == "application/octet-stream"


@pytest.mark.anyio
async def test_upload_file_validate_returns_metadata_and_preserves_position():
    stream = io.BytesIO(b"abcdef")
    stream.seek(3)
    upload = UploadFile(
        file=stream,
        filename="letters.txt",
        headers=Headers({"content-type": "text/plain"}),
        max_size=6,
        allowed_content_types=["text/plain"],
    )

    result = await upload.validate()

    assert result.is_valid is True
    assert result.file_size == 6
    assert result.content_type == "text/plain"
    assert stream.tell() == 3


@pytest.mark.anyio
async def test_upload_file_write_checks_projected_size():
    upload = UploadFile(
        file=io.BytesIO(b"abc"),
        filename="letters.txt",
        size=3,
        max_size=4,
    )

    with pytest.raises(HTTPException) as exc_info:
        await upload.write(b"de")

    assert exc_info.value.status_code == 413


def test_request_upload_file_is_wrapped_with_validation_method():
    app = FastAPI()

    @app.post("/upload")
    async def upload(file: UploadFile):
        result = await file.validate()
        return {
            "is_fastapi_upload": isinstance(file, UploadFile),
            "file_size": result.file_size,
            "content_type": result.content_type,
        }

    client = TestClient(app)

    response = client.post(
        "/upload",
        files={"file": ("hello.txt", b"hello", "text/plain")},
    )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "is_fastapi_upload": True,
        "file_size": 5,
        "content_type": "text/plain",
    }
