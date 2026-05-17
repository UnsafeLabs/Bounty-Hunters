"""jsonable_encoder with bytes and Enum handling"""
from typing import Any
from enum import Enum
import json, base64

def jsonable_encoder(obj: Any, **kwargs) -> Any:
    if isinstance(obj, bytes):
        try: return obj.decode("utf-8")
        except: return base64.b64encode(obj).decode()
    if isinstance(obj, Enum): return obj.value
    if hasattr(obj, "dict") and callable(getattr(obj, "dict")): return obj.dict()
    if hasattr(obj, "__dict__"): return obj.__dict__
    if isinstance(obj, dict): return {k: jsonable_encoder(v, **kwargs) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)): return [jsonable_encoder(x, **kwargs) for x in obj]
    try: json.dumps(obj); return obj
    except (TypeError, ValueError): return str(obj)
