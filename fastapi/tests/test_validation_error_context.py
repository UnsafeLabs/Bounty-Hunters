import importlib.util, sys
from pathlib import Path
PATH = Path(__file__).resolve().parents[1] / "fastapi" / "validation_error_context.py"

def _load():
    name = "vec"
    if name in sys.modules: del sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, PATH)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod

def test_redact_and_debug():
    mod = _load()
    body = {"username": "a", "password": "secret", "nested": {"api_key": "k", "ok": 1}}
    red = mod.redact_sensitive(body)
    assert red["password"] == "***REDACTED***"
    assert red["nested"]["api_key"] == "***REDACTED***"
    assert red["nested"]["ok"] == 1
    p = mod.build_validation_error_payload(
        errors=[{"loc": ["body", "x"], "msg": "field required"}],
        path="/login",
        method="post",
        body=body,
        debug=True,
    )
    assert p["path"] == "/login" and p["method"] == "POST"
    assert p["body"]["password"] == "***REDACTED***"
    p2 = mod.build_validation_error_payload(
        errors=[], path="/x", method="get", body=body, debug=False
    )
    assert "body" not in p2
    print("ALL PASSED")

if __name__ == "__main__":
    test_redact_and_debug()
