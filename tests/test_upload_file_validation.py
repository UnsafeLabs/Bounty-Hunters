"""Tests for UploadFile validation."""

import tempfile
from pathlib import Path

import pytest
from starlette.exceptions import HTTPException
from starlette.datastructures import Headers

from fastapi.datastructures import UploadFile, ValidationResult


class TestUploadFileValidation:
    """Test suite for UploadFile validation features."""

    @pytest.mark.asyncio
    async def test_no_validation_when_max_size_none(self):
        """When max_size is None, no size check is performed."""
        with tempfile.NamedTemporaryFile(delete=False) as f:
            f.write(b"some data")
            f.flush()
            file = UploadFile(
                file=open(f.name, "rb"),
                filename="test.txt",
                size=9,
            )
            # max_size is None by default
            result = await file.validate()
            assert result.is_valid
            assert result.file_size == 9
            assert result.content_type is None
            file.file.close()
            Path(f.name).unlink(missing_ok=True)

    @pytest.mark.asyncio
    async def test_file_size_within_limit(self):
        """File that is within max_size passes validation."""
        with tempfile.NamedTemporaryFile(delete=False) as f:
            f.write(b"small file")
            f.flush()
            file = UploadFile(
                file=open(f.name, "rb"),
                filename="test.txt",
                size=10,
            )
            file.max_size = 100
            result = await file.validate()
            assert result.is_valid
            assert result.file_size == 10
            file.file.close()
            Path(f.name).unlink(missing_ok=True)

    @pytest.mark.asyncio
    async def test_file_exceeds_max_size_raises_413(self):
        """Files exceeding max_size raise HTTPException 413."""
        with tempfile.NamedTemporaryFile(delete=False) as f:
            f.write(b"this file is too large for the limit")
            f.flush()
            file = UploadFile(
                file=open(f.name, "rb"),
                filename="test.txt",
                size=32,
            )
            file.max_size = 10
            with pytest.raises(HTTPException) as exc:
                await file.validate()
            assert exc.value.status_code == 413
            file.file.close()
            Path(f.name).unlink(missing_ok=True)

    @pytest.mark.asyncio
    async def test_no_content_type_validation_when_allowed_none(self):
        """When allowed_content_types is None, no type check is performed."""
        with tempfile.NamedTemporaryFile(delete=False) as f:
            f.write(b"data")
            f.flush()
            file = UploadFile(
                file=open(f.name, "rb"),
                filename="test.xyz",
                size=4,
                headers=Headers({"content-type": "application/octet-stream"}),
            )
            # allowed_content_types is None by default
            result = await file.validate()
            assert result.is_valid
            assert result.content_type == "application/octet-stream"
            file.file.close()
            Path(f.name).unlink(missing_ok=True)

    @pytest.mark.asyncio
    async def test_allowed_content_type_passes(self):
        """File with allowed content type passes validation."""
        with tempfile.NamedTemporaryFile(delete=False) as f:
            f.write(b'{"key": "value"}')
            f.flush()
            file = UploadFile(
                file=open(f.name, "rb"),
                filename="test.json",
                size=16,
                headers=Headers({"content-type": "application/json"}),
            )
            file.allowed_content_types = ["application/json", "text/plain"]
            result = await file.validate()
            assert result.is_valid
            assert result.content_type == "application/json"
            file.file.close()
            Path(f.name).unlink(missing_ok=True)

    @pytest.mark.asyncio
    async def test_disallowed_content_type_raises_415(self):
        """File with disallowed content type raises HTTPException 415."""
        with tempfile.NamedTemporaryFile(delete=False) as f:
            f.write(b"<html></html>")
            f.flush()
            file = UploadFile(
                file=open(f.name, "rb"),
                filename="test.html",
                size=14,
                headers=Headers({"content-type": "text/html"}),
            )
            file.allowed_content_types = ["application/json", "text/plain"]
            with pytest.raises(HTTPException) as exc:
                await file.validate()
            assert exc.value.status_code == 415
            file.file.close()
            Path(f.name).unlink(missing_ok=True)

    @pytest.mark.asyncio
    async def test_validate_returns_file_metadata(self):
        """The validate method returns accurate file metadata."""
        with tempfile.NamedTemporaryFile(delete=False) as f:
            content = b"metadata check"
            f.write(content)
            f.flush()
            file = UploadFile(
                file=open(f.name, "rb"),
                filename="test.txt",
                size=len(content),
                headers=Headers({"content-type": "text/plain"}),
            )
            result = await file.validate()
            assert result.file_size == len(content)
            assert result.content_type == "text/plain"
            assert result.is_valid
            file.file.close()
            Path(f.name).unlink(missing_ok=True)

    @pytest.mark.asyncio
    async def test_backward_compatible_without_new_params(self):
        """Existing UploadFile usage without new params works unchanged."""
        with tempfile.NamedTemporaryFile(delete=False) as f:
            f.write(b"backward compatible test")
            f.flush()
            file = UploadFile(
                file=open(f.name, "rb"),
                filename="test.txt",
                size=22,
            )
            # Verify standard methods still work
            data = await file.read()
            assert data == b"backward compatible test"
            await file.seek(0)
            assert await file.read() == b"backward compatible test"
            await file.close()
            Path(f.name).unlink(missing_ok=True)

    @pytest.mark.asyncio
    async def test_validate_with_file_size_unknown(self):
        """validate() works when size is None by reading the file."""
        with tempfile.NamedTemporaryFile(delete=False) as f:
            f.write(b"unknown size file")
            f.flush()
            file = UploadFile(
                file=open(f.name, "rb"),
                filename="test.txt",
                size=None,  # Size not known upfront
            )
            file.max_size = 100
            result = await file.validate()
            assert result.is_valid
            assert result.file_size == 17
            file.file.close()
            Path(f.name).unlink(missing_ok=True)
