"""Tests for jsonable_encoder v2"""
import pytest
from jsonable_encoder_v2 import jsonable_encoder
from enum import Enum
class Color(Enum): RED = 1; BLUE = 2
class TestEncV2:
    def test_bytes_encoding(self):
        assert jsonable_encoder(b"hello") == "hello"
    def test_enum_value(self):
        assert jsonable_encoder(Color.RED) == 1
    def test_custom_object(self):
        class Obj: pass
        o = Obj(); o.x = 1
        assert jsonable_encoder(o) == {"x": 1}
    def test_nested_dict(self):
        assert jsonable_encoder({"a": [1]}) == {"a": [1]}
    def test_non_serializable(self):
        assert jsonable_encoder(lambda x: x) is not None
