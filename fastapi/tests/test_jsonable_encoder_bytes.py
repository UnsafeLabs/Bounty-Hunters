"""Tests for jsonable_encoder bytes and memoryview handling."""
import base64

import pytest
from fastapi.encoders import jsonable_encoder


class TestBytesEncoding:
    """Test bytes objects are properly encoded."""

    def test_bytes_base64_default(self):
        """bytes objects are base64-encoded by default."""
        data = b"hello world"
        result = jsonable_encoder(data)
        expected = base64.b64encode(data).decode("ascii")
        assert result == expected

    def test_bytes_base64_explicit(self):
        """bytes_encoding='base64' produces base64 output."""
        data = b"\x00\x01\x02\xff"
        result = jsonable_encoder(data, bytes_encoding="base64")
        expected = base64.b64encode(data).decode("ascii")
        assert result == expected

    def test_bytes_hex(self):
        """bytes_encoding='hex' produces hexadecimal output."""
        data = b"\x00\x01\x02\xff"
        result = jsonable_encoder(data, bytes_encoding="hex")
        expected = data.hex()
        assert result == expected
        assert result == "000102ff"

    def test_bytes_empty(self):
        """Empty bytes produce empty string."""
        assert jsonable_encoder(b"") == ""
        assert jsonable_encoder(b"", bytes_encoding="hex") == ""

    def test_bytes_binary_data(self):
        """Non-UTF-8 binary data is handled without error."""
        data = bytes(range(256))
        result = jsonable_encoder(data)
        expected = base64.b64encode(data).decode("ascii")
        assert result == expected

    def test_bytes_in_dict(self):
        """bytes values in dicts are encoded properly."""
        data = {"key": b"binary_value"}
        result = jsonable_encoder(data)
        expected_val = base64.b64encode(b"binary_value").decode("ascii")
        assert result == {"key": expected_val}

    def test_bytes_in_list(self):
        """bytes values in lists are encoded properly."""
        data = [b"first", b"second"]
        result = jsonable_encoder(data)
        expected = [
            base64.b64encode(b"first").decode("ascii"),
            base64.b64encode(b"second").decode("ascii"),
        ]
        assert result == expected


class TestMemoryviewEncoding:
    """Test memoryview objects are properly encoded."""

    def test_memoryview_base64_default(self):
        """memoryview objects are base64-encoded by default."""
        data = memoryview(b"hello world")
        result = jsonable_encoder(data)
        expected = base64.b64encode(b"hello world").decode("ascii")
        assert result == expected

    def test_memoryview_hex(self):
        """memoryview with bytes_encoding='hex' produces hex output."""
        data = memoryview(b"\xde\xad\xbe\xef")
        result = jsonable_encoder(data, bytes_encoding="hex")
        assert result == "deadbeef"

    def test_memoryview_empty(self):
        """Empty memoryview produces empty string."""
        assert jsonable_encoder(memoryview(b"")) == ""

    def test_memoryview_in_dict(self):
        """memoryview values in dicts are encoded properly."""
        data = {"data": memoryview(b"test")}
        result = jsonable_encoder(data)
        expected_val = base64.b64encode(b"test").decode("ascii")
        assert result == {"data": expected_val}


class TestBytesEncodingInParameter:
    """Test that bytes_encoding propagates through nested structures."""

    def test_bytes_encoding_in_nested_dict(self):
        """bytes_encoding applies to bytes in nested dicts."""
        data = {"outer": {"inner": b"\xff\xfe"}}
        result_b64 = jsonable_encoder(data, bytes_encoding="base64")
        result_hex = jsonable_encoder(data, bytes_encoding="hex")
        assert result_b64 == {"outer": {"inner": base64.b64encode(b"\xff\xfe").decode("ascii")}}
        assert result_hex == {"outer": {"inner": "fffe"}}

    def test_bytes_encoding_in_nested_list(self):
        """bytes_encoding applies to bytes in nested lists."""
        data = [[b"\xab\xcd"]]
        result_b64 = jsonable_encoder(data, bytes_encoding="base64")
        result_hex = jsonable_encoder(data, bytes_encoding="hex")
        assert result_b64 == [[base64.b64encode(b"\xab\xcd").decode("ascii")]]
        assert result_hex == [[b"\xab\xcd".hex()]]


class TestExistingBehaviorPreserved:
    """Ensure existing encoder behavior for other types is unchanged."""

    def test_string_unchanged(self):
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
        assert jsonable_encoder([1, "two", 3.0]) == [1, "two", 3.0]

    def test_dict_unchanged(self):
        assert jsonable_encoder({"a": 1}) == {"a": 1}

    def test_datetime_still_works(self):
        import datetime
        dt = datetime.datetime(2024, 1, 15, 10, 30, 0)
        result = jsonable_encoder(dt)
        assert result == "2024-01-15T10:30:00"

    def test_uuid_still_works(self):
        from uuid import UUID
        uid = UUID("12345678-1234-5678-1234-567812345678")
        assert jsonable_encoder(uid) == "12345678-1234-5678-1234-567812345678"

    def test_enum_still_works(self):
        from enum import Enum
        class Color(Enum):
            RED = "red"
        assert jsonable_encoder(Color.RED) == "red"
