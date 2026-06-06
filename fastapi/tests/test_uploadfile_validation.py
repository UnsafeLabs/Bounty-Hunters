from io import BytesIO

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers


@pytest.mark.anyio
async def test_upload_file_validate_returns_metadata():
    upload = UploadFile(
        BytesIO(b"hello"),
        filename="hello.txt",
        headers=Headers({"content-type": "text/plain"}),
        max_size=10,
        allowed_content_types=["text/plain"],
    )

    result = await upload.validate()

    assert result.is_valid is True
    assert result.file_size == 5
    assert result.content_type == "text/plain"


@pytest.mark.anyio
async def test_upload_file_validate_raises_413_for_large_file():
    upload = UploadFile(BytesIO(b"toolarge"), max_size=3)

    with pytest.raises(HTTPException) as exc_info:
        await upload.validate()

    assert exc_info.value.status_code == 413


@pytest.mark.anyio
async def test_upload_file_validate_raises_415_for_disallowed_content_type():
    upload = UploadFile(
        BytesIO(b"{}"),
        headers=Headers({"content-type": "application/json"}),
        allowed_content_types=["text/plain"],
    )

    with pytest.raises(HTTPException) as exc_info:
        await upload.validate()

    assert exc_info.value.status_code == 415


@pytest.mark.anyio
async def test_upload_file_validation_skips_unset_constraints():
    upload = UploadFile(
        BytesIO(b"large enough"),
        headers=Headers({"content-type": "application/octet-stream"}),
    )

    result = await upload.validate()

    assert result.file_size == len(b"large enough")
    assert result.content_type == "application/octet-stream"


@pytest.mark.anyio
async def test_upload_file_validate_preserves_file_position():
    upload = UploadFile(BytesIO(b"abcdef"), max_size=10)
    upload.file.seek(3)

    await upload.validate()

    assert upload.file.tell() == 3
