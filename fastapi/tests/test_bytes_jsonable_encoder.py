import base64

import pytest
from fastapi.encoders import jsonable_encoder


def test_bytes_encoded_as_base64():
    data = {"value": b"hello world"}
    result = jsonable_encoder(data)
    assert result["value"] == base64.b64encode(b"hello world").decode("ascii")


def test_empty_bytes():
    data = {"value": b""}
    result = jsonable_encoder(data)
    assert result["value"] == ""


def test_bytes_encoding_hex():
    data = {"value": b"hello"}
    result = jsonable_encoder(data, bytes_encoding="hex")
    assert result["value"] == b"hello".hex()


def test_memoryview_handled():
    data = {"value": memoryview(b"test data")}
    result = jsonable_encoder(data)
    assert result["value"] == base64.b64encode(b"test data").decode("ascii")


def test_memoryview_hex():
    data = {"value": memoryview(b"hex test")}
    result = jsonable_encoder(data, bytes_encoding="hex")
    assert result["value"] == b"hex test".hex()


def test_existing_types_unchanged():
    data = {"name": "test", "count": 42, "active": True, "tags": ["a", "b"]}
    result = jsonable_encoder(data)
    assert result == {"name": "test", "count": 42, "active": True, "tags": ["a", "b"]}


def test_bytes_in_list():
    data = [b"item1", b"item2"]
    result = jsonable_encoder(data)
    assert result == [
        base64.b64encode(b"item1").decode("ascii"),
        base64.b64encode(b"item2").decode("ascii"),
    ]


def test_bytes_in_nested_dict():
    data = {"outer": {"inner": b"nested"}}
    result = jsonable_encoder(data)
    assert result["outer"]["inner"] == base64.b64encode(b"nested").decode("ascii")
