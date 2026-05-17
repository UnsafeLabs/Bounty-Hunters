"""Tests for jsonable_encoder"""
import pytest
from jsonable_encoder import jsonable_encoder
from enum import Enum
class Color(Enum): RED=1; BLUE=2
class TestEnc:
    def test_bytes(self): assert jsonable_encoder(b"hello") == "hello"
    def test_enum(self): assert jsonable_encoder(Color.RED) == 1
    def test_nested(self): assert jsonable_encoder({"a":[1]}) == {"a":[1]}
    def test_custom(self):
        class O: pass; o=O(); o.x=1; assert jsonable_encoder(o) == {"x":1}
