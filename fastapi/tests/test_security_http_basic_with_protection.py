import hashlib

import pytest
from starlette.requests import Request

from fastapi.exceptions import HTTPException
from fastapi.security import HTTPBasicWithProtection


def make_request(host="127.0.0.1"):
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [],
        "client": (host, 12345),
    }
    return Request(scope)


def test_failed_attempts_are_tracked_per_ip():
    security = HTTPBasicWithProtection(max_attempts=3, window_seconds=60)

    security.record_failed_attempt(make_request("10.0.0.1"))
    security.record_failed_attempt(make_request("10.0.0.2"))

    assert len(security._failed_attempts["10.0.0.1"]) == 1
    assert len(security._failed_attempts["10.0.0.2"]) == 1


def test_lockout_returns_429_with_retry_after_header():
    security = HTTPBasicWithProtection(max_attempts=2, window_seconds=60)
    request = make_request()

    security.record_failed_attempt(request)
    security.record_failed_attempt(request)

    with pytest.raises(HTTPException) as exc_info:
        security._raise_if_locked_out(request)

    assert exc_info.value.status_code == 429
    assert int(exc_info.value.headers["Retry-After"]) > 0


def test_successful_authentication_resets_attempts():
    security = HTTPBasicWithProtection(max_attempts=2, window_seconds=60)
    request = make_request()

    security.record_failed_attempt(request)
    security.reset_attempts(request)

    assert security.retry_after(request) == 0
    assert security._failed_attempts["127.0.0.1"] == []


def test_verify_password_uses_timing_safe_comparison_for_sha256_hash():
    digest = hashlib.sha256(b"secret").hexdigest()

    assert HTTPBasicWithProtection.verify_password("secret", f"sha256${digest}")
    assert not HTTPBasicWithProtection.verify_password("wrong", f"sha256${digest}")
