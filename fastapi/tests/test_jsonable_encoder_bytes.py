from fastapi.encoders import jsonable_encoder


def test_bytes_base64():
    result = jsonable_encoder(b"hello")
    assert result == "aGVsbG8="


def test_bytes_hex():
    result = jsonable_encoder(b"hello", bytes_encoding="hex")
    assert result == "68656c6c6f"


def test_memoryview_base64():
    result = jsonable_encoder(memoryview(b"test"))
    assert result == "dGVzdA=="


def test_memoryview_hex():
    result = jsonable_encoder(memoryview(b"test"), bytes_encoding="hex")
    assert result == "74657374"


def test_empty_bytes():
    assert jsonable_encoder(b"") == ""


def test_existing_types_unaffected():
    assert jsonable_encoder(42) == 42
    assert jsonable_encoder("hello") == "hello"
    assert jsonable_encoder(None) is None
    assert jsonable_encoder([1, 2, 3]) == [1, 2, 3]
    assert jsonable_encoder({"a": 1}) == {"a": 1}
