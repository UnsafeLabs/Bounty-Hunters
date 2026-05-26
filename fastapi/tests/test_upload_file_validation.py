import io

import pytest
from fastapi import HTTPException, UploadFile, UploadFileValidationResult
from starlette.datastructures import Headers


@pytest.mark.anyio
async def test_upload_file_validate_returns_metadata() -> None:
    upload = UploadFile(
        file=io.BytesIO(b"hello"),
        filename="hello.txt",
        headers=Headers({"content-type": "text/plain"}),
    )

    result = await upload.validate()

    assert isinstance(result, UploadFileValidationResult)
    assert result.is_valid is True
    assert result.file_size == 5
    assert result.content_type == "text/plain"


@pytest.mark.anyio
async def test_upload_file_validate_raises_for_large_files() -> None:
    upload = UploadFile(
        file=io.BytesIO(b"hello"),
        filename="hello.txt",
        headers=Headers({"content-type": "text/plain"}),
        max_size=4,
    )

    with pytest.raises(HTTPException) as exc_info:
        await upload.validate()

    assert exc_info.value.status_code == 413


@pytest.mark.anyio
async def test_upload_file_validate_raises_for_disallowed_content_type() -> None:
    upload = UploadFile(
        file=io.BytesIO(b"hello"),
        filename="hello.txt",
        headers=Headers({"content-type": "text/plain"}),
        allowed_content_types=["application/json"],
    )

    with pytest.raises(HTTPException) as exc_info:
        await upload.validate()

    assert exc_info.value.status_code == 415


@pytest.mark.anyio
async def test_upload_file_validate_skips_unconfigured_constraints() -> None:
    upload = UploadFile(
        file=io.BytesIO(b"hello"),
        filename="hello.txt",
        headers=Headers({"content-type": "text/plain"}),
    )

    result = await upload.validate()

    assert result.is_valid is True


@pytest.mark.anyio
async def test_upload_file_validate_preserves_file_position() -> None:
    upload = UploadFile(
        file=io.BytesIO(b"hello"),
        filename="hello.txt",
        headers=Headers({"content-type": "text/plain"}),
        max_size=10,
        allowed_content_types=["text/plain"],
    )

    await upload.seek(2)
    result = await upload.validate()
    remaining = await upload.read()

    assert result.file_size == 5
    assert remaining == b"llo"
