#!/usr/bin/env python3
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'fastapi'))

from fastapi.encoders import jsonable_encoder
import base64

def test_bytes_and_memoryview():
    # Test bytes
    b = b'hello'
    result = jsonable_encoder(b)
    expected = base64.b64encode(b).decode()
    assert result == expected, f"Expected {expected}, got {result}"

    # Test bytes with hex encoding
    result_hex = jsonable_encoder(b, bytes_encoding='hex')
    expected_hex = b.hex()
    assert result_hex == expected_hex, f"Expected {expected_hex}, got {result_hex}"

    # Test memoryview
    mv = memoryview(b'world')
    result_mv = jsonable_encoder(mv)
    expected_mv = base64.b64encode(bytes(mv)).decode()
    assert result_mv == expected_mv, f"Expected {expected_mv}, got {result_mv}"

    # Test memoryview with hex encoding
    result_mv_hex = jsonable_encoder(mv, bytes_encoding='hex')
    expected_mv_hex = bytes(mv).hex()
    assert result_mv_hex == expected_mv_hex, f"Expected {expected_mv_hex}, got {result_mv_hex}"

    # Test that existing types still work
    assert jsonable_encoder('test') == 'test'
    assert jsonable_encoder(5) == 5
    assert jsonable_encoder([1,2,3]) == [1,2,3]
    assert jsonable_encoder({'a': b'bytes'}) == {'a': base64.b64encode(b'bytes').decode()}

    print("All tests passed!")

if __name__ == '__main__':
    test_bytes_and_memoryview()