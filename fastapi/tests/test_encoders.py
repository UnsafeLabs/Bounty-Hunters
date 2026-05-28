"""Tests for encoders.py - jsonable_encoder bytes and memoryview handling."""

import base64
import pytest

from fastapi.encoders import jsonable_encoder


class TestBytesEncoding:
    """Tests for bytes encoding in jsonable_encoder."""

    def test_bytes_base64_default(self):
        """Bytes should be base64-encoded by default."""
        data = b"hello world"
        result = jsonable_encoder(data)
        expected = base64.b64encode(data).decode("ascii")
        assert result == expected

    def test_bytes_hex_encoding(self):
        """Bytes should be hex-encoded when bytes_encoding='hex'."""
        data = b"hello world"
        result = jsonable_encoder(data, bytes_encoding="hex")
        assert result == data.hex()

    def test_bytes_base64_explicit(self):
        """Bytes should be base64-encoded when bytes_encoding='base64'."""
        data = b"hello world"
        result = jsonable_encoder(data, bytes_encoding="base64")
        expected = base64.b64encode(data).decode("ascii")
        assert result == expected

    def test_bytes_empty(self):
        """Empty bytes should encode to empty string."""
        result = jsonable_encoder(b"")
        assert result == ""

    def test_bytes_in_dict(self):
        """Bytes in dict values should be encoded."""
        data = {"file": b"binary content", "name": "test"}
        result = jsonable_encoder(data)
        assert result["name"] == "test"
        assert result["file"] == base64.b64encode(b"binary content").decode("ascii")

    def test_bytes_in_list(self):
        """Bytes in list items should be encoded."""
        data = [b"first", b"second", "text"]
        result = jsonable_encoder(data)
        assert result[0] == base64.b64encode(b"first").decode("ascii")
        assert result[1] == base64.b64encode(b"second").decode("ascii")
        assert result[2] == "text"

    def test_bytes_nested_in_dict(self):
        """Bytes in nested dicts should be encoded."""
        data = {"user": {"avatar": b"image data"}}
        result = jsonable_encoder(data)
        assert result["user"]["avatar"] == base64.b64encode(b"image data").decode("ascii")


class TestMemoryviewEncoding:
    """Tests for memoryview encoding in jsonable_encoder."""

    def test_memoryview_base64_default(self):
        """memoryview should be converted to base64 by default."""
        data = memoryview(b"hello world")
        result = jsonable_encoder(data)
        expected = base64.b64encode(b"hello world").decode("ascii")
        assert result == expected

    def test_memoryview_hex_encoding(self):
        """memoryview should be converted to hex when bytes_encoding='hex'."""
        data = memoryview(b"hello world")
        result = jsonable_encoder(data, bytes_encoding="hex")
        assert result == b"hello world".hex()

    def test_memoryview_in_dict(self):
        """memoryview in dict values should be encoded."""
        data = {"buffer": memoryview(b"binary"), "name": "test"}
        result = jsonable_encoder(data)
        assert result["name"] == "test"
        assert result["buffer"] == base64.b64encode(b"binary").decode("ascii")

    def test_memoryview_empty(self):
        """Empty memoryview should encode to empty string."""
        result = jsonable_encoder(memoryview(b""))
        assert result == ""


class TestBytesEncodingWithPydantic:
    """Tests for bytes encoding with Pydantic models."""

    def test_pydantic_model_with_bytes(self):
        """Pydantic model with bytes field should encode correctly."""
        from pydantic import BaseModel

        class FileModel(BaseModel):
            name: str
            content: bytes

        model = FileModel(name="test.txt", content=b"file content")
        result = jsonable_encoder(model)
        assert result["name"] == "test.txt"
        assert result["content"] == base64.b64encode(b"file content").decode("ascii")

    def test_pydantic_model_with_bytes_hex(self):
        """Pydantic model with bytes field should use hex encoding."""
        from pydantic import BaseModel

        class FileModel(BaseModel):
            name: str
            content: bytes

        model = FileModel(name="test.txt", content=b"file content")
        result = jsonable_encoder(model, bytes_encoding="hex")
        assert result["content"] == b"file content".hex()

    def test_pydantic_model_with_nested_bytes(self):
        """Pydantic model with nested bytes should encode correctly."""
        from pydantic import BaseModel

        class Metadata(BaseModel):
            data: bytes

        class FileModel(BaseModel):
            name: str
            meta: Metadata

        model = FileModel(name="test.txt", meta=Metadata(data=b"meta content"))
        result = jsonable_encoder(model)
        assert result["name"] == "test.txt"
        assert result["meta"]["data"] == base64.b64encode(b"meta content").decode("ascii")
