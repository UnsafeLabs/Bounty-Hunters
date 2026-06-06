import io

import pytest
from fastapi import UploadFile, UploadFileValidationResult
from starlette.datastructures import Headers
from starlette.exceptions import HTTPException


@pytest.mark.anyio
async def test_upload_file_validate_returns_metadata_and_preserves_position():
    stream = io.BytesIO(b"abcdef")
    stream.seek(3)
    upload = UploadFile(
        file=stream,
        filename="data.txt",
        headers=Headers({"content-type": "text/plain"}),
        max_size=10,
        allowed_content_types=["text/plain"],
    )

    result = await upload.validate()

    assert isinstance(result, UploadFileValidationResult)
    assert result.is_valid is True
    assert result.file_size == 6
    assert result.content_type == "text/plain"
    assert stream.tell() == 3


@pytest.mark.anyio
async def test_upload_file_validate_uses_known_size_without_reading_file():
    stream = io.BytesIO(b"abc")
    upload = UploadFile(
        file=stream,
        size=123,
        headers=Headers({"content-type": "application/octet-stream"}),
    )

    result = await upload.validate()

    assert result.file_size == 123
    assert stream.tell() == 0


@pytest.mark.anyio
async def test_upload_file_validate_rejects_oversized_file():
    upload = UploadFile(file=io.BytesIO(b"abcdef"), max_size=5)

    with pytest.raises(HTTPException) as exc_info:
        await upload.validate()

    assert exc_info.value.status_code == 413


@pytest.mark.anyio
async def test_upload_file_validate_skips_size_check_when_max_size_is_none():
    upload = UploadFile(file=io.BytesIO(b"abcdef"), max_size=None)

    result = await upload.validate()

    assert result.is_valid is True
    assert result.file_size == 6


@pytest.mark.anyio
async def test_upload_file_validate_rejects_disallowed_content_type():
    upload = UploadFile(
        file=io.BytesIO(b"image"),
        headers=Headers({"content-type": "image/png"}),
        allowed_content_types=["text/plain"],
    )

    with pytest.raises(HTTPException) as exc_info:
        await upload.validate()

    assert exc_info.value.status_code == 415


@pytest.mark.anyio
async def test_upload_file_validate_skips_content_type_check_without_allowlist():
    upload = UploadFile(
        file=io.BytesIO(b"image"),
        headers=Headers({"content-type": "image/png"}),
        allowed_content_types=None,
    )

    result = await upload.validate()

    assert result.is_valid is True
    assert result.content_type == "image/png"
