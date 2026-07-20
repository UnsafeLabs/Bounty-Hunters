"""Tests for router-level middleware (#796)."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

PATH = Path(__file__).resolve().parents[1] / "fastapi" / "router_middleware.py"


def _load():
    name = "router_mw_local"
    if name in sys.modules:
        del sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, PATH)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def test_order_and_isolation():
    mod = _load()
    calls = []

    class MW:
        def __init__(self, app, name="x"):
            self.app = app
            self.name = name

        def __call__(self, value):
            calls.append(f"enter:{self.name}")
            out = self.app(value)
            calls.append(f"exit:{self.name}")
            return out

    def base(v):
        calls.append("handler")
        return v + 1

    # router A middleware
    a = mod.RouterMiddlewareMixin(middleware=[(MW, {"name": "a1"}), (MW, {"name": "a2"})])
    app_a = mod.apply_middleware_stack(base, a.iter_middleware())
    assert app_a(0) == 1
    # last added outermost: a2 then a1 then handler
    assert calls == ["enter:a2", "enter:a1", "handler", "exit:a1", "exit:a2"]

    calls.clear()
    b = mod.RouterMiddlewareMixin()
    b.add_middleware(MW, name="only-b")
    app_b = mod.apply_middleware_stack(base, b.iter_middleware())
    app_b(0)
    assert calls == ["enter:only-b", "handler", "exit:only-b"]
    # isolation: A stack != B
    assert "a1" not in "".join(calls)


def test_include_router_preserves_child_middleware():
    mod = _load()
    parent = [(object, {"p": 1})]
    child = [(object, {"c": 1})]
    merged = mod.merge_router_middleware(parent, child)
    assert merged[0] is child[0]
    assert merged[1] is parent[0]


def test_callable_middleware():
    mod = _load()
    log = []

    def factory(app):
        def wrapped(v):
            log.append("mw")
            return app(v)

        return wrapped

    def base(v):
        return v * 2

    app = mod.apply_middleware_stack(base, [factory])
    assert app(3) == 6
    assert log == ["mw"]


if __name__ == "__main__":
    test_order_and_isolation()
    print("ok order")
    test_include_router_preserves_child_middleware()
    print("ok include")
    test_callable_middleware()
    print("ok callable")
    print("ALL PASSED")
