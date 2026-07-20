"""Tests for OAuth2 refresh support (#758)."""

from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path

PATH = Path(__file__).resolve().parents[1] / "fastapi" / "security" / "oauth2_refresh.py"


def _load():
    # stub parent
    if "fastapi.security.oauth2" not in sys.modules:
        if "fastapi" not in sys.modules:
            sys.modules["fastapi"] = types.ModuleType("fastapi")
        if "fastapi.security" not in sys.modules:
            sys.modules["fastapi.security"] = types.ModuleType("fastapi.security")
        oauth = types.ModuleType("fastapi.security.oauth2")

        class OAuth2PasswordBearer:
            def __init__(self, tokenUrl, scheme_name=None, scopes=None, description=None, auto_error=True):
                self.tokenUrl = tokenUrl
                self.scheme_name = scheme_name or "OAuth2PasswordBearer"
                self.auto_error = auto_error
                self.model = type("M", (), {})()

        oauth.OAuth2PasswordBearer = OAuth2PasswordBearer
        sys.modules["fastapi.security.oauth2"] = oauth

    name = "oauth2_refresh_local"
    if name in sys.modules:
        del sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, PATH)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def test_refresh_form_validation():
    mod = _load()
    form = mod.OAuth2RefreshRequestForm(grant_type="refresh_token", refresh_token="abc")
    assert form.refresh_token == "abc"
    try:
        mod.OAuth2RefreshRequestForm(grant_type="password", refresh_token="x")
        assert False
    except ValueError:
        pass
    try:
        mod.OAuth2RefreshRequestForm(grant_type="refresh_token", refresh_token="")
        assert False
    except ValueError:
        pass


def test_bearer_with_refresh_url():
    mod = _load()
    bearer = mod.OAuth2PasswordBearerWithRefresh(
        tokenUrl="/token",
        refresh_url="/token/refresh",
    )
    assert bearer.openapi_refresh_url() == "/token/refresh"
    assert bearer.refresh_url == "/token/refresh"


if __name__ == "__main__":
    test_refresh_form_validation()
    print("ok form")
    test_bearer_with_refresh_url()
    print("ok bearer")
    print("ALL PASSED")
