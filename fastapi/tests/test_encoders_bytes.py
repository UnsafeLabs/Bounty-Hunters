"""Tests for bytes and memoryview handling in jsonable_encoder."""
import base64
import pytest
from fastapi.encoders import jsonable_encoder


def test_bytes_base64_default():
    """bytes are encoded as base64 by default."""
    data = b'\xff\xfe\x00\x01'
    expected = base64.b64encode(data).decode()
    result = jsonable_encoder(data)
    assert isinstance(result, str)
    assert result == expected


def test_bytes_hex_encoding():
    """bytes_encoding='hex' produces hex output."""
    data = b'\xff\xfe'
    result = jsonable_encoder(data, bytes_encoding='hex')
    assert result == 'fffe'


def test_memoryview_base64():
    """memoryview objects are handled without errors."""
    data = memoryview(b'\x00\x01\x02')
    result = jsonable_encoder(data)
    assert isinstance(result, str)
    assert 'AAEC' in result


def test_memoryview_hex():
    """memoryview with hex encoding."""
    data = memoryview(b'\x00\x01')
    result = jsonable_encoder(data, bytes_encoding='hex')
    assert result == '0001'


def test_bytes_in_dict():
    """bytes inside dicts are encoded."""
    data = {'name': 'test', 'raw': b'\xff\xfe'}
    expected_raw = base64.b64encode(b'\xff\xfe').decode()
    result = jsonable_encoder(data)
    assert result['name'] == 'test'
    assert result['raw'] == expected_raw


def test_bytes_in_list():
    """bytes inside lists are encoded."""
    data = [b'abc', b'\x00\xff']
    result = jsonable_encoder(data)
    assert len(result) == 2
    assert isinstance(result[0], str)
    assert isinstance(result[1], str)


def test_existing_behavior_unchanged():
    """Existing encoder behavior for all other types is unchanged."""
    assert jsonable_encoder('hello') == 'hello'
    assert jsonable_encoder(42) == 42
    assert jsonable_encoder(3.14) == 3.14
    assert jsonable_encoder(None) is None
    assert jsonable_encoder([1, 2, 3]) == [1, 2, 3]
    assert jsonable_encoder({'a': 1}) == {'a': 1}