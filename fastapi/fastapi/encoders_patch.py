"""
Fix jsonable_encoder to handle bytes and memoryview objects.
"""
import base64
from typing import Any


def encode_bytes(obj: bytes) -> str:
    """Encode bytes as base64 string for JSON serialization."""
    return base64.b64encode(obj).decode("ascii")


def encode_memoryview(obj: memoryview) -> str:
    """Encode memoryview as base64 string for JSON serialization."""
    return base64.b64encode(obj.tobytes()).decode("ascii")


def jsonable_encoder_patch(obj: Any) -> Any:
    """
    Patch for jsonable_encoder to handle bytes and memoryview.
    
    Apply by importing and checking types before default serialization.
    """
    if isinstance(obj, bytes):
        return encode_bytes(obj)
    elif isinstance(obj, memoryview):
        return encode_memoryview(obj)
    elif isinstance(obj, bytearray):
        return encode_bytes(bytes(obj))
    return None  # Not handled, use default
