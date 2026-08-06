import base64
from fastapi.encoders import jsonable_encoder


def test_bytes_default_base64_encoding():
    data = b"hello world"
    encoded = jsonable_encoder(data)
    assert encoded == base64.b64encode(b"hello world").decode("ascii")


def test_bytes_hex_encoding():
    data = b"hello world"
    encoded = jsonable_encoder(data, bytes_encoding="hex")
    assert encoded == b"hello world".hex()


def test_memoryview_encoding():
    data = memoryview(b"memoryview data")
    encoded_default = jsonable_encoder(data)
    assert encoded_default == base64.b64encode(b"memoryview data").decode("ascii")

    encoded_hex = jsonable_encoder(data, bytes_encoding="hex")
    assert encoded_hex == b"memoryview data".hex()


def test_bytes_in_dict_and_list():
    data = {"file": b"data", "stream": memoryview(b"stream")}
    encoded = jsonable_encoder(data)
    assert encoded["file"] == base64.b64encode(b"data").decode("ascii")
    assert encoded["stream"] == base64.b64encode(b"stream").decode("ascii")
