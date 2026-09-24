import asyncio
import io

import pytest
from starlette.datastructures import Headers

from fastapi import HTTPException, UploadFile


def build_upload_file(
    data: bytes,
    *,
    content_type: str = "application/octet-stream",
    **kwargs,
) -> UploadFile:
    return UploadFile(
        io.BytesIO(data),
        size=len(data),
        filename="example.txt",
        headers=Headers({"content-type": content_type}),
        **kwargs,
    )


def test_no_constraints_passes():
    upload = build_upload_file(b"hello")
    result = asyncio.run(upload.validate())
    assert result.is_valid is True
    assert result.file_size == 5
    assert result.content_type == "application/octet-stream"


def test_size_is_measured_from_file_when_unknown():
    upload = UploadFile(
        io.BytesIO(b"abcdef"),
        filename="example.txt",
        headers=Headers({"content-type": "text/plain"}),
    )
    result = asyncio.run(upload.validate())
    assert result.file_size == 6


def test_oversized_file_raises_413():
    upload = build_upload_file(b"1234567890", max_size=4)
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(upload.validate())
    assert exc_info.value.status_code == 413


def test_disallowed_content_type_raises_415():
    upload = build_upload_file(b"data", allowed_content_types=["image/png"])
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(upload.validate())
    assert exc_info.value.status_code == 415


def test_within_limits_passes():
    upload = build_upload_file(
        b"data",
        content_type="text/plain",
        max_size=10,
        allowed_content_types=["text/plain"],
    )
    result = asyncio.run(upload.validate())
    assert result.is_valid is True
    assert result.content_type == "text/plain"


def test_per_call_constraints_are_applied():
    upload = build_upload_file(b"1234567890")
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(upload.validate(max_size=3))
    assert exc_info.value.status_code == 413


def test_default_upload_file_has_no_constraints():
    upload = UploadFile(io.BytesIO(b"x"))
    assert upload.max_size is None
    assert upload.allowed_content_types is None
    result = asyncio.run(upload.validate())
    assert result.file_size == 1
    assert result.content_type is None
