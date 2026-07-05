from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import Depends, FastAPI, Security
from fastapi.security import APIKeyWithRateLimit
from fastapi.testclient import TestClient
from pydantic import BaseModel


class User(BaseModel):
    username: str


def make_client(security: APIKeyWithRateLimit) -> TestClient:
    app = FastAPI()

    def get_current_user(api_key: str = Security(security)) -> User:
        return User(username=api_key)

    @app.get("/users/me")
    def read_current_user(current_user: User = Depends(get_current_user)) -> User:
        return current_user

    return TestClient(app)


def test_rate_limit_is_enforced_per_api_key() -> None:
    client = make_client(APIKeyWithRateLimit(name="key", rate_limit="2/minute"))

    assert client.get("/users/me", headers={"key": "alpha"}).status_code == 200
    assert client.get("/users/me", headers={"key": "alpha"}).status_code == 200

    response = client.get("/users/me", headers={"key": "alpha"})
    assert response.status_code == 429, response.text
    assert response.json() == {"detail": "Rate limit exceeded"}
    assert int(response.headers["Retry-After"]) > 0

    response = client.get("/users/me", headers={"key": "beta"})
    assert response.status_code == 200, response.text
    assert response.json() == {"username": "beta"}


def test_rate_limit_window_resets(monkeypatch) -> None:
    monotonic_now = 100.0
    monkeypatch.setattr(
        "fastapi.security.api_key.time.monotonic", lambda: monotonic_now
    )
    client = make_client(APIKeyWithRateLimit(name="key", rate_limit="1/second"))

    assert client.get("/users/me", headers={"key": "alpha"}).status_code == 200

    response = client.get("/users/me", headers={"key": "alpha"})
    assert response.status_code == 429, response.text
    assert response.headers["Retry-After"] == "1"

    monotonic_now = 102.0

    response = client.get("/users/me", headers={"key": "alpha"})
    assert response.status_code == 200, response.text


def test_deprecated_key_adds_warning_header() -> None:
    client = make_client(
        APIKeyWithRateLimit(
            name="key",
            rate_limit="10/minute",
            deprecated_keys={"old-secret"},
        )
    )

    response = client.get("/users/me", headers={"key": "old-secret"})
    assert response.status_code == 200, response.text
    assert response.headers["Warning"] == (
        '299 - "API key is deprecated and will be deactivated"'
    )

    response = client.get("/users/me", headers={"key": "new-secret"})
    assert response.status_code == 200, response.text
    assert "Warning" not in response.headers


def test_missing_key_uses_existing_api_key_header_behavior() -> None:
    client = make_client(APIKeyWithRateLimit(name="key", rate_limit="10/minute"))

    response = client.get("/users/me")

    assert response.status_code == 401, response.text
    assert response.json() == {"detail": "Not authenticated"}
    assert response.headers["WWW-Authenticate"] == "APIKey"


@pytest.mark.parametrize("rate_limit", ["", "abc/minute", "0/minute", "5/month"])
def test_invalid_rate_limit(rate_limit: str) -> None:
    with pytest.raises(ValueError):
        APIKeyWithRateLimit(name="key", rate_limit=rate_limit)


def test_store_handles_concurrent_requests() -> None:
    client = make_client(APIKeyWithRateLimit(name="key", rate_limit="20/minute"))

    with ThreadPoolExecutor(max_workers=4) as executor:
        responses = list(
            executor.map(
                lambda _: client.get("/users/me", headers={"key": "alpha"}),
                range(8),
            )
        )

    assert {response.status_code for response in responses} == {200}
