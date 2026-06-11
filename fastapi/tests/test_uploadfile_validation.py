from io import BytesIO

import pytest
from fastapi import FastAPI, File, UploadFile
from fastapi.datastructures import Headers
from fastapi.exceptions import HTTPException
from fastapi.testclient import TestClient


def upload_file(
    content: bytes = b"hello",
    *,
    content_type: str = "text/plain",
    max_size: int | None = None,
    allowed_content_types: list[str] | None = None,
) -> UploadFile:
    return UploadFile(
        file=BytesIO(content),
        filename="example.txt",
        headers=Headers({"content-type": content_type}),
        max_size=max_size,
        allowed_content_types=allowed_content_types,
    )


@pytest.mark.anyio
async def test_uploadfile_validate_returns_file_metadata() -> None:
    file = upload_file(
        b"hello",
        max_size=10,
        allowed_content_types=["text/plain"],
    )

    result = await file.validate()

    assert result.is_valid is True
    assert result.file_size == 5
    assert result.content_type == "text/plain"
    assert await file.read() == b"hello"


@pytest.mark.anyio
async def test_uploadfile_validate_raises_413_when_file_is_too_large() -> None:
    file = upload_file(b"toolarge", max_size=3)

    with pytest.raises(HTTPException) as exc_info:
        await file.validate()

    assert exc_info.value.status_code == 413


@pytest.mark.anyio
async def test_uploadfile_validate_raises_415_for_disallowed_content_type() -> None:
    file = upload_file(
        b"hello",
        content_type="application/octet-stream",
        allowed_content_types=["text/plain"],
    )

    with pytest.raises(HTTPException) as exc_info:
        await file.validate()

    assert exc_info.value.status_code == 415


@pytest.mark.anyio
async def test_uploadfile_validate_skips_unset_constraints() -> None:
    file = upload_file(b"any-size", content_type="application/octet-stream")

    result = await file.validate()

    assert result.is_valid is True
    assert result.file_size == 8
    assert result.content_type == "application/octet-stream"


def test_existing_uploadfile_route_usage_still_works() -> None:
    app = FastAPI()

    @app.post("/upload")
    async def upload(file: UploadFile = File()):
        return {"filename": file.filename, "content": (await file.read()).decode()}

    response = TestClient(app).post(
        "/upload",
        files={"file": ("hello.txt", b"hello", "text/plain")},
    )

    assert response.status_code == 200
    assert response.json() == {"filename": "hello.txt", "content": "hello"}
