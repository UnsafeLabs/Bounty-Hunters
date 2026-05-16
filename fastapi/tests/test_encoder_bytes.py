"""Tests for encoders bytes/memoryview handling."""

import base64
import binascii
import pytest
from encoders import jsonable_encoder


class TestBytesEncoding:
    def test_bytes_default_base64(self):
        data = b"hello world"
        result = jsonable_encoder(data)
        expected = base64.b64encode(data).decode("ascii")
        assert result == expected
        assert isinstance(result, str)

    def test_bytes_hex_encoding(self):
        data = b"abc123"
        result = jsonable_encoder(data, bytes_encoding="hex")
        expected = binascii.hexlify(data).decode("ascii")
        assert result == expected

    def test_bytes_in_dict_default_base64(self):
        data = {"name": "test", "payload": b"\x00\x01\x02"}
        result = jsonable_encoder(data)
        assert result["name"] == "test"
        assert result["payload"] == base64.b64encode(b"\x00\x01\x02").decode("ascii")

    def test_bytes_in_list(self):
        data = [b"first", b"second"]
        result = jsonable_encoder(data)
        assert isinstance(result, list)
        assert len(result) == 2
        for item in result:
            assert isinstance(item, str)
            assert base64.b64decode(item.encode("ascii"))

    def test_empty_bytes(self):
        result = jsonable_encoder(b"", bytes_encoding="hex")
        assert result == ""


class TestMemoryviewEncoding:
    def test_memoryview_base64(self):
        data = memoryview(b"test memoryview")
        result = jsonable_encoder(data)
        expected = base64.b64encode(b"test memoryview").decode("ascii")
        assert result == expected

    def test_memoryview_hex(self):
        data = memoryview(b"hex test")
        result = jsonable_encoder(data, bytes_encoding="hex")
        expected = binascii.hexlify(b"hex test").decode("ascii")
        assert result == expected

    def test_empty_memoryview(self):
        result = jsonable_encoder(memoryview(b""), bytes_encoding="hex")
        assert result == ""


class TestExistingBehavior:
    def test_string_unchanged(self):
        assert jsonable_encoder("hello") == "hello"

    def test_int_unchanged(self):
        assert jsonable_encoder(42) == 42

    def test_float_unchanged(self):
        assert jsonable_encoder(3.14) == 3.14

    def test_none_unchanged(self):
        assert jsonable_encoder(None) is None

    def test_nested_dict(self):
        data = {"a": 1, "b": b"nested", "c": {"d": memoryview(b"deep")}}
        result = jsonable_encoder(data)
        assert result["a"] == 1
        assert result["b"] == base64.b64encode(b"nested").decode("ascii")
        assert result["c"]["d"] == base64.b64encode(b"deep").decode("ascii")

    def test_datetime_unchanged(self):
        from datetime import datetime
        dt = datetime(2024, 1, 1, 0, 0, 0)
        result = jsonable_encoder(dt)
        assert "2024" in result