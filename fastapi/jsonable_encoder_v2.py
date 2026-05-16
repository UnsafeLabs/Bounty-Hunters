"""jsonable_encoder with TypeVar and bytes handling"""
from typing import Any, Union
from enum import Enum
import json

def jsonable_encoder(obj: Any, **kwargs) -> Any:
    if isinstance(obj, bytes):
        return obj.decode("utf-8", errors="replace")
    if isinstance(obj, Enum):
        return obj.value
    if hasattr(obj, "dict") and callable(getattr(obj, "dict")):
        return obj.dict()
    if hasattr(obj, "__dict__"):
        return obj.__dict__
    if isinstance(obj, dict):
        return {k: jsonable_encoder(v, **kwargs) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [jsonable_encoder(x, **kwargs) for x in obj]
    try:
        json.dumps(obj)
        return obj
    except (TypeError, ValueError):
        return str(obj)
