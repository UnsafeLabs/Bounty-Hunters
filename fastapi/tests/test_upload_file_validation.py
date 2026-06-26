import io

import pytest
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.testclient import TestClient
from starlette.datastructures import Headers


def upload_file(
    content: bytes,
    *,
    content_type: str | None = "text/plain",
    max_size: int | None = None,
    allowed_content_types: list[str] | None = None,
    size: int | None = None,
) -> UploadFile:
    headers = Headers({"content-type": content_type}) if content_type else None
    return UploadFile(
        file=io.BytesIO(content),
        filename="example.txt",
        headers=headers,
        size=size,
        max_size=max_size,
        allowed_content_types=allowed_content_types,
    )


@pytest.mark.anyio
async def test_upload_file_validate_returns_metadata_and_preserves_position():
    file = upload_file(b"payload", size=None)
    await file.seek(3)

    result = await file.validate()

    assert result.is_valid is True
    assert result.file_size == 7
    assert result.content_type == "text/plain"
    assert await file.read() == b"load"


@pytest.mark.anyio
async def test_upload_file_max_size_raises_413_when_exceeded():
    file = upload_file(b"too large", max_size=3)

    with pytest.raises(HTTPException) as exc_info:
        await file.validate()

    assert exc_info.value.status_code == 413
    assert exc_info.value.detail["max_size"] == 3
    assert exc_info.value.detail["file_size"] == 9


@pytest.mark.anyio
async def test_upload_file_max_size_none_skips_size_check():
    file = upload_file(b"large enough", max_size=None)

    result = await file.validate()

    assert result.is_valid is True
    assert result.file_size == 12


@pytest.mark.anyio
async def test_upload_file_allowed_content_types_raises_415_when_disallowed():
    file = upload_file(
        b"{}",
        content_type="application/json",
        allowed_content_types=["text/plain"],
    )

    with pytest.raises(HTTPException) as exc_info:
        await file.validate()

    assert exc_info.value.status_code == 415
    assert exc_info.value.detail["content_type"] == "application/json"
    assert exc_info.value.detail["allowed_content_types"] == ["text/plain"]


@pytest.mark.anyio
async def test_upload_file_allowed_content_types_none_skips_type_check():
    file = upload_file(
        b"{}",
        content_type="application/json",
        allowed_content_types=None,
    )

    result = await file.validate()

    assert result.is_valid is True
    assert result.content_type == "application/json"


@pytest.mark.anyio
async def test_upload_file_existing_usage_without_constraints_still_works():
    file = UploadFile(file=io.BytesIO(b"data"), filename="example.txt")

    result = await file.validate()

    assert result.is_valid is True
    assert result.file_size == 4
    assert await file.read() == b"data"
    await file.close()


def test_upload_file_route_parameter_exposes_validate_method():
    app = FastAPI()

    @app.post("/uploadfile/")
    async def create_upload_file(file: UploadFile):
        result = await file.validate()
        return {
            "file_size": result.file_size,
            "content_type": result.content_type,
            "class_name": file.__class__.__name__,
        }

    client = TestClient(app)
    response = client.post(
        "/uploadfile/",
        files={"file": ("example.txt", b"data", "text/plain")},
    )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "file_size": 4,
        "content_type": "text/plain",
        "class_name": "UploadFile",
    }
