import base64

import pytest
from fastapi.encoders import jsonable_encoder


def test_bytes_encoded_as_base64():
    """bytes objects are encoded as base64 strings by default."""
    data = {"value": b"hello world"}
    result = jsonable_encoder(data)
    assert result["value"] == base64.b64encode(b"hello world").decode("ascii")


def test_bytes_encoding_hex():
    """Setting bytes_encoding to hex produces hexadecimal output."""
    data = {"value": b"hello"}
    result = jsonable_encoder(data, bytes_encoding="hex")
    assert result["value"] == b"hello".hex()


def test_memoryview_handled():
    """memoryview objects are handled without errors."""
    data = {"value": memoryview(b"test data")}
    result = jsonable_encoder(data)
    assert result["value"] == base64.b64encode(b"test data").decode("ascii")


def test_memoryview_hex():
    """memoryview with hex encoding."""
    data = {"value": memoryview(b"hello")}
    result = jsonable_encoder(data, bytes_encoding="hex")
    assert result["value"] == b"hello".hex()


def test_existing_types_unchanged():
    """Existing encoder behavior for all other types is unchanged."""
    assert jsonable_encoder("hello") == "hello"
    assert jsonable_encoder(42) == 42
    assert jsonable_encoder(3.14) == 3.14
    assert jsonable_encoder(None) is None
    assert jsonable_encoder(True) is True
    assert jsonable_encoder([1, 2, 3]) == [1, 2, 3]
    assert jsonable_encoder({"a": 1}) == {"a": 1}


def test_bytes_in_list():
    """bytes objects inside lists are encoded."""
    data = [b"a", b"b", "text"]
    result = jsonable_encoder(data)
    assert result == [
        base64.b64encode(b"a").decode("ascii"),
        base64.b64encode(b"b").decode("ascii"),
        "text",
    ]


def test_bytes_in_nested_dict():
    """bytes objects in nested structures are handled."""
    data = {"outer": {"inner": b"nested"}}
    result = jsonable_encoder(data)
    assert result["outer"]["inner"] == base64.b64encode(b"nested").decode("ascii")