import time

from fastapi import Depends, FastAPI
from fastapi.security import APIKeyWithRateLimit
from fastapi.testclient import TestClient


def make_app(scheme):
    app = FastAPI()

    @app.get("/items/")
    async def read_items(key: str = Depends(scheme)):
        return {"key": key}

    return app


def test_valid_request_within_limit():
    scheme = APIKeyWithRateLimit(name="x-key", rate_limit="5/second")
    client = TestClient(make_app(scheme))
    response = client.get("/items/", headers={"x-key": "abc"})
    assert response.status_code == 200, response.text
    assert response.json() == {"key": "abc"}


def test_rate_limit_enforced_returns_429_with_retry_after():
    scheme = APIKeyWithRateLimit(name="x-key", rate_limit="3/second")
    client = TestClient(make_app(scheme))
    for _ in range(3):
        response = client.get("/items/", headers={"x-key": "abc"})
        assert response.status_code == 200, response.text
    response = client.get("/items/", headers={"x-key": "abc"})
    assert response.status_code == 429, response.text
    assert response.json()["detail"] == "Too many requests"
    assert "Retry-After" in response.headers
    assert response.headers["Retry-After"].isdigit()
    assert int(response.headers["Retry-After"]) >= 1


def test_rate_limit_independent_per_key():
    scheme = APIKeyWithRateLimit(name="x-key", rate_limit="1/second")
    client = TestClient(make_app(scheme))
    assert client.get("/items/", headers={"x-key": "A"}).status_code == 200
    assert client.get("/items/", headers={"x-key": "A"}).status_code == 429
    # A different key keeps its own budget.
    assert client.get("/items/", headers={"x-key": "B"}).status_code == 200


def test_deprecated_key_gets_warning_header():
    scheme = APIKeyWithRateLimit(
        name="x-key", rate_limit="100/minute", deprecated_keys=["old"]
    )
    client = TestClient(make_app(scheme))
    response = client.get("/items/", headers={"x-key": "old"})
    assert response.status_code == 200, response.text
    assert "Warning" in response.headers
    assert "deprecated" in response.headers["Warning"]


def test_non_deprecated_key_has_no_warning_header():
    scheme = APIKeyWithRateLimit(
        name="x-key", rate_limit="100/minute", deprecated_keys=["old"]
    )
    client = TestClient(make_app(scheme))
    response = client.get("/items/", headers={"x-key": "fresh"})
    assert response.status_code == 200, response.text
    assert "Warning" not in response.headers


def test_window_resets_after_interval():
    scheme = APIKeyWithRateLimit(name="x-key", rate_limit="1/second")
    client = TestClient(make_app(scheme))
    assert client.get("/items/", headers={"x-key": "abc"}).status_code == 200
    assert client.get("/items/", headers={"x-key": "abc"}).status_code == 429
    time.sleep(1.1)
    assert client.get("/items/", headers={"x-key": "abc"}).status_code == 200


def test_missing_key_returns_401():
    scheme = APIKeyWithRateLimit(name="x-key", rate_limit="100/minute")
    client = TestClient(make_app(scheme))
    response = client.get("/items/")
    assert response.status_code == 401, response.text
    assert response.headers["WWW-Authenticate"] == "APIKey"
