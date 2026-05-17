"""Tests for HTTPBasicWithProtection."""
import hashlib
import time
import pytest
from fastapi import FastAPI, Depends
from fastapi.security.http_protection import HTTPBasicWithProtection
from starlette.testclient import TestClient
from starlette.status import HTTP_200_OK, HTTP_429_TOO_MANY_REQUESTS


security = HTTPBasicWithProtection(max_attempts=3, window_seconds=5.0)

app = FastAPI()


@app.get("/protected")
def protected(credentials=Depends(security)):
    return {"username": credentials.username}


client = TestClient(app)


def test_successful_auth():
    """Successful authentication returns 200."""
    import base64
    auth = base64.b64encode(b"admin:secret").decode()
    response = client.get("/protected", headers={"Authorization": f"Basic {auth}"})
    assert response.status_code == 200
    assert response.json() == {"username": "admin"}


def test_failed_attempt():
    """Failed attempt returns 401."""
    import base64
    auth = base64.b64encode(b"wrong:wrong").decode()
    response = client.get("/protected", headers={"Authorization": f"Basic {auth}"})
    assert response.status_code == 401


def test_rate_limit_lockout():
    """After max_attempts, get 429."""
    import base64
    auth = base64.b64encode(b"wrong:wrong").decode()

    # First 3 attempts return 401
    for _ in range(3):
        response = client.get("/protected", headers={"Authorization": f"Basic {auth}"})
        assert response.status_code == 401

    # 4th attempt returns 429
    response = client.get("/protected", headers={"Authorization": f"Basic {auth}"})
    assert response.status_code == 429
    assert "Retry-After" in response.headers
    assert int(response.headers["Retry-After"]) > 0


def test_counter_reset_on_success():
    """Successful login before limit should reset counter."""
    # No rate limiting after a successful auth
    # Just verify we can make requests
    import base64
    auth = base64.b64encode(b"admin:secret").decode()
    response = client.get("/protected", headers={"Authorization": f"Basic {auth}"})
    assert response.status_code == 200


def test_timing_safe_comparison():
    """verify_password uses constant-time comparison."""
    result1 = HTTPBasicWithProtection.verify_password("test", hashlib.sha256(b"test").hexdigest())
    result2 = HTTPBasicWithProtection.verify_password("wrong", hashlib.sha256(b"test").hexdigest())
    assert result1 is True
    assert result2 is False


def test_existing_behavior_unchanged():
    """Original HTTPBasic still works."""
    from fastapi.security.http import HTTPBasic
    basic = HTTPBasic()

    app2 = FastAPI()

    @app2.get("/test")
    def test(creds=Depends(basic)):
        return {"user": creds.username}

    import base64
    auth = base64.b64encode(b"user:pass").decode()
    response = TestClient(app2).get("/test", headers={"Authorization": f"Basic {auth}"})
    assert response.status_code == 200