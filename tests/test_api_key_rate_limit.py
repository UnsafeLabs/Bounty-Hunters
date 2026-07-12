"""Tests for APIKeyWithRateLimit."""
from __future__ import annotations

import importlib.util
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient


def _load_api_key_module():
    path = (
        Path(__file__).resolve().parents[1]
        / "fastapi"
        / "fastapi"
        / "security"
        / "api_key.py"
    )
    spec = importlib.util.spec_from_file_location("api_key_rl", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


mod = _load_api_key_module()
APIKeyWithRateLimit = mod.APIKeyWithRateLimit
parse_rate_limit = mod.parse_rate_limit
DEPRECATION_WARNING = mod.DEPRECATION_WARNING


def test_parse_rate_limit():
    assert parse_rate_limit("100/minute") == (100, 60)
    assert parse_rate_limit("1000/hour") == (1000, 3600)
    assert parse_rate_limit("5/second") == (5, 1)
    with pytest.raises(ValueError):
        parse_rate_limit("nope")


def _app(scheme: APIKeyWithRateLimit) -> TestClient:
    app = FastAPI()

    @app.get("/secure")
    async def secure(key: str = Depends(scheme)):
        return {"key": key}

    return TestClient(app)


def test_rate_limit_enforcement_and_retry_after():
    scheme = APIKeyWithRateLimit(name="X-API-Key", rate_limit="3/minute")
    client = _app(scheme)
    headers = {"X-API-Key": "key-a"}
    for _ in range(3):
        assert client.get("/secure", headers=headers).status_code == 200
    limited = client.get("/secure", headers=headers)
    assert limited.status_code == 429
    assert "Retry-After" in limited.headers
    assert int(limited.headers["Retry-After"]) >= 1
    # Independent per key
    assert client.get("/secure", headers={"X-API-Key": "key-b"}).status_code == 200


def test_sliding_window_reset(monkeypatch):
    scheme = APIKeyWithRateLimit(name="X-API-Key", rate_limit="2/second")
    client = _app(scheme)
    headers = {"X-API-Key": "k1"}
    assert client.get("/secure", headers=headers).status_code == 200
    assert client.get("/secure", headers=headers).status_code == 200
    assert client.get("/secure", headers=headers).status_code == 429
    time.sleep(1.1)
    assert client.get("/secure", headers=headers).status_code == 200


def test_deprecated_key_warning_header():
    scheme = APIKeyWithRateLimit(
        name="X-API-Key",
        rate_limit="100/minute",
        deprecated_keys=["old-key"],
    )
    client = _app(scheme)
    r_old = client.get("/secure", headers={"X-API-Key": "old-key"})
    assert r_old.status_code == 200
    assert r_old.headers.get("Warning") == DEPRECATION_WARNING
    r_new = client.get("/secure", headers={"X-API-Key": "new-key"})
    assert r_new.status_code == 200
    assert "Warning" not in r_new.headers


def test_concurrent_requests_safe():
    scheme = APIKeyWithRateLimit(name="X-API-Key", rate_limit="50/minute")
    client = _app(scheme)
    headers = {"X-API-Key": "concurrent"}

    def hit():
        return client.get("/secure", headers=headers).status_code

    with ThreadPoolExecutor(max_workers=16) as pool:
        codes = list(pool.map(lambda _: hit(), range(50)))
    assert all(c == 200 for c in codes)
    assert client.get("/secure", headers=headers).status_code == 429
