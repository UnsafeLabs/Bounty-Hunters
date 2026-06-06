import pytest
from fastapi import Depends, FastAPI, Security
from fastapi.security import APIKeyWithRateLimit
from fastapi.security import api_key as api_key_module
from fastapi.testclient import TestClient


def make_client(security: APIKeyWithRateLimit) -> TestClient:
    app = FastAPI()

    def get_current_key(api_key: str = Security(security)):
        return api_key

    @app.get("/limited")
    def limited(api_key: str = Depends(get_current_key)):
        return {"api_key": api_key}

    return TestClient(app)


def test_api_key_rate_limit_tracks_each_key_independently():
    client = make_client(APIKeyWithRateLimit(name="key", rate_limit="2/minute"))

    assert client.get("/limited", headers={"key": "alpha"}).status_code == 200
    assert client.get("/limited", headers={"key": "alpha"}).status_code == 200

    response = client.get("/limited", headers={"key": "alpha"})
    assert response.status_code == 429
    assert response.json() == {"detail": "Rate limit exceeded"}
    assert response.headers["Retry-After"] == "60"

    response = client.get("/limited", headers={"key": "beta"})
    assert response.status_code == 200
    assert response.json() == {"api_key": "beta"}


def test_api_key_rate_limit_resets_after_window(monkeypatch: pytest.MonkeyPatch):
    current_time = 0.0

    def monotonic() -> float:
        return current_time

    monkeypatch.setattr(api_key_module.time, "monotonic", monotonic)
    client = make_client(APIKeyWithRateLimit(name="key", rate_limit="1/second"))

    assert client.get("/limited", headers={"key": "alpha"}).status_code == 200
    response = client.get("/limited", headers={"key": "alpha"})
    assert response.status_code == 429
    assert response.headers["Retry-After"] == "1"

    current_time = 1.1
    response = client.get("/limited", headers={"key": "alpha"})
    assert response.status_code == 200


def test_deprecated_keys_authenticate_with_warning_header():
    client = make_client(
        APIKeyWithRateLimit(
            name="key",
            rate_limit="10/minute",
            deprecated_keys=["old-key"],
        )
    )

    response = client.get("/limited", headers={"key": "old-key"})
    assert response.status_code == 200
    assert response.json() == {"api_key": "old-key"}
    assert response.headers["Warning"] == (
        '299 - "API key is deprecated and will be deactivated"'
    )

    response = client.get("/limited", headers={"key": "new-key"})
    assert response.status_code == 200
    assert "Warning" not in response.headers


def test_api_key_with_rate_limit_preserves_missing_key_error():
    client = make_client(APIKeyWithRateLimit(name="key", rate_limit="10/minute"))

    response = client.get("/limited")
    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated"}
    assert response.headers["WWW-Authenticate"] == "APIKey"


@pytest.mark.parametrize("rate_limit", ["0/minute", "ten/minute", "10/month", "10"])
def test_invalid_rate_limit_raises_value_error(rate_limit: str):
    with pytest.raises(ValueError):
        APIKeyWithRateLimit(name="key", rate_limit=rate_limit)
