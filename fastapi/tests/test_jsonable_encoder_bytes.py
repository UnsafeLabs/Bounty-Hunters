"""Tests for bytes and memoryview encoding in jsonable_encoder."""
import base64

import pytest

from fastapi.encoders import jsonable_encoder


class TestBytesEncoding:
    """Test bytes objects are encoded correctly."""

    def test_bytes_default_base64(self):
        """bytes objects are base64-encoded by default."""
        data = b"hello world"
        result = jsonable_encoder(data)
        assert result == base64.b64encode(data).decode("ascii")
        assert result == "aGVsbG8gd29ybGQ="

    def test_bytes_base64_explicit(self):
        """bytes objects with explicit bytes_encoding='base64'."""
        data = b"hello world"
        result = jsonable_encoder(data, bytes_encoding="base64")
        assert result == base64.b64encode(data).decode("ascii")

    def test_bytes_hex(self):
        """bytes objects with bytes_encoding='hex' produce hex output."""
        data = b"\xff\xfe"
        result = jsonable_encoder(data, bytes_encoding="hex")
        assert result == "fffe"

    def test_bytes_non_utf8_base64(self):
        """Non-UTF-8 bytes are handled via base64 (no TypeError)."""
        data = b"\x80\x81\x82"
        result = jsonable_encoder(data)
        assert result == base64.b64encode(data).decode("ascii")
        assert result == "gIGC"

    def test_bytes_non_utf8_hex(self):
        """Non-UTF-8 bytes with hex encoding."""
        data = b"\x80\x81\x82"
        result = jsonable_encoder(data, bytes_encoding="hex")
        assert result == "808182"

    def test_empty_bytes(self):
        """Empty bytes produce empty string."""
        assert jsonable_encoder(b"") == ""
        assert jsonable_encoder(b"", bytes_encoding="hex") == ""

    def test_bytearray_base64(self):
        """bytearray objects are encoded same as bytes."""
        data = bytearray(b"hello")
        result = jsonable_encoder(data)
        assert result == "aGVsbG8="

    def test_bytearray_hex(self):
        """bytearray with hex encoding."""
        data = bytearray(b"\xff\xfe")
        result = jsonable_encoder(data, bytes_encoding="hex")
        assert result == "fffe"

    def test_bytes_subclass(self):
        """Subclass of bytes is handled correctly."""
        class MyBytes(bytes):
            pass
        data = MyBytes(b"hello")
        result = jsonable_encoder(data)
        assert result == "aGVsbG8="


class TestMemoryviewEncoding:
    """Test memoryview objects are handled correctly."""

    def test_memoryview_default_base64(self):
        """memoryview objects are converted to bytes then base64-encoded."""
        data = memoryview(b"hello world")
        result = jsonable_encoder(data)
        assert result == base64.b64encode(b"hello world").decode("ascii")

    def test_memoryview_hex(self):
        """memoryview objects with hex encoding."""
        data = memoryview(b"\xff\xfe")
        result = jsonable_encoder(data, bytes_encoding="hex")
        assert result == "fffe"

    def test_memoryview_empty(self):
        """Empty memoryview produces empty string."""
        data = memoryview(b"")
        assert jsonable_encoder(data) == ""


class TestBytesInContainers:
    """Test bytes inside dicts and lists."""

    def test_bytes_in_dict(self):
        """bytes values in dicts are encoded."""
        data = {"key": b"hello"}
        result = jsonable_encoder(data)
        assert result == {"key": "aGVsbG8="}

    def test_bytes_in_list(self):
        """bytes values in lists are encoded."""
        data = [b"hello", b"world"]
        result = jsonable_encoder(data)
        assert result == ["aGVsbG8=", "d29ybGQ="]

    def test_bytes_in_dict_hex(self):
        """bytes values in dicts with hex encoding."""
        data = {"key": b"\xff"}
        result = jsonable_encoder(data, bytes_encoding="hex")
        assert result == {"key": "ff"}


class TestInvalidEncoding:
    """Test invalid bytes_encoding values."""

    def test_invalid_encoding_raises(self):
        """Unsupported bytes_encoding raises ValueError."""
        with pytest.raises(ValueError, match="bytes_encoding must be"):
            jsonable_encoder(b"hello", bytes_encoding="base85")

    def test_invalid_encoding_on_memoryview(self):
        """Unsupported bytes_encoding raises ValueError for memoryview."""
        with pytest.raises(ValueError, match="bytes_encoding must be"):
            jsonable_encoder(memoryview(b"hello"), bytes_encoding="ascii85")


class TestExistingBehaviorUnchanged:
    """Verify existing encoder behavior is not broken."""

    def test_str_unchanged(self):
        assert jsonable_encoder("hello") == "hello"

    def test_int_unchanged(self):
        assert jsonable_encoder(42) == 42

    def test_float_unchanged(self):
        assert jsonable_encoder(3.14) == 3.14

    def test_none_unchanged(self):
        assert jsonable_encoder(None) is None

    def test_bool_unchanged(self):
        assert jsonable_encoder(True) is True

    def test_list_unchanged(self):
        assert jsonable_encoder([1, "two", 3]) == [1, "two", 3]

    def test_dict_unchanged(self):
        assert jsonable_encoder({"a": 1}) == {"a": 1}

    def test_nested_dict_unchanged(self):
        data = {"a": {"b": [1, 2, 3]}}
        assert jsonable_encoder(data) == {"a": {"b": [1, 2, 3]}}
