"""Tests for HTTPBasic brute force protection (#800)."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

PATH = Path(__file__).resolve().parents[1] / "fastapi" / "security" / "http_basic_protection.py"


def _load():
    name = "http_basic_prot_local"
    if name in sys.modules:
        del sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, PATH)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def test_attempt_tracking_and_lockout():
    mod = _load()
    prot = mod.HTTPBasicWithProtection(max_attempts=3, window_seconds=60)
    now = 1_000_000.0
    assert prot.check_lockout("1.1.1.1", now=now) is None
    assert prot.register_failure("1.1.1.1", now=now) is None
    assert prot.register_failure("1.1.1.1", now=now + 1) is None
    retry = prot.register_failure("1.1.1.1", now=now + 2)
    assert retry is not None and retry >= 1
    # other IP independent
    assert prot.check_lockout("2.2.2.2", now=now + 2) is None


def test_reset_on_success():
    mod = _load()
    prot = mod.HTTPBasicWithProtection(max_attempts=2, window_seconds=60)
    now = 2_000_000.0
    prot.register_failure("9.9.9.9", now=now)
    prot.register_success("9.9.9.9")
    assert prot.check_lockout("9.9.9.9", now=now + 1) is None


def test_timing_safe_password():
    mod = _load()
    assert mod.HTTPBasicWithProtection.verify_password("secret", "secret") is True
    assert mod.HTTPBasicWithProtection.verify_password("secret", "Secret") is False
    assert mod.HTTPBasicWithProtection.verify_password("a", "ab") is False
    h = __import__("hashlib").sha256(b"salty" + b"pw").hexdigest()
    assert mod.HTTPBasicWithProtection.verify_password_hash("pw", h, salt="salty") is True


if __name__ == "__main__":
    test_attempt_tracking_and_lockout()
    print("ok lockout")
    test_reset_on_success()
    print("ok reset")
    test_timing_safe_password()
    print("ok verify")
    print("ALL PASSED")
