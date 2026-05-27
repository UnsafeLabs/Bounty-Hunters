from fastapi import Depends, FastAPI, Security
from fastapi.security import APIKeyHeader
from fastapi.testclient import TestClient
from inline_snapshot import snapshot
from pydantic import BaseModel

app = FastAPI()

api_key = APIKeyHeader(name="key")


class User(BaseModel):
    username: str


def get_current_user(oauth_header: str = Security(api_key)):
    user = User(username=oauth_header)
    return user


@app.get("/users/me")
def read_current_user(current_user: User = Depends(get_current_user)):
    return current_user


client = TestClient(app)


def test_security_api_key():
    response = client.get("/users/me", headers={"key": "secret"})
    assert response.status_code == 200, response.text
    assert response.json() == {"username": "secret"}


def test_security_api_key_no_key():
    response = client.get("/users/me")
    assert response.status_code == 401, response.text
    assert response.json() == {"detail": "Not authenticated"}
    assert response.headers["WWW-Authenticate"] == "APIKey"


def test_openapi_schema():
    response = client.get("/openapi.json")
    assert response.status_code == 200, response.text
    assert response.json() == snapshot(
        {
            "openapi": "3.1.0",
            "info": {"title": "FastAPI", "version": "0.1.0"},
            "paths": {
                "/users/me": {
                    "get": {
                        "responses": {
                            "200": {
                                "description": "Successful Response",
                                "content": {"application/json": {"schema": {}}},
                            }
                        },
                        "summary": "Read Current User",
                        "operationId": "read_current_user_users_me_get",
                        "security": [{"APIKeyHeader": []}],
                    }
                }
            },
            "components": {
                "securitySchemes": {
                    "APIKeyHeader": {"type": "apiKey", "name": "key", "in": "header"}
                }
            },
        }
    )


def test_security_api_key_rate_limit():
    """Test that rate limiting works for APIKeyHeader."""
    rate_limited_api_key = APIKeyHeader(name="key", max_requests=2, window_seconds=60)
    rate_app = FastAPI()

    def get_current_user(oauth_header: str = Security(rate_limited_api_key)):
        user = User(username=oauth_header)
        return user

    @rate_app.get("/users/me")
    def read_current_user(current_user: User = Depends(get_current_user)):
        return current_user

    rate_client = TestClient(rate_app)

    # First two requests should succeed
    response = rate_client.get("/users/me", headers={"key": "secret"})
    assert response.status_code == 200, response.text
    assert response.json() == {"username": "secret"}

    response = rate_client.get("/users/me", headers={"key": "secret"})
    assert response.status_code == 200, response.text
    assert response.json() == {"username": "secret"}

    # Third request should be rate limited
    response = rate_client.get("/users/me", headers={"key": "secret"})
    assert response.status_code == 429, response.text
    assert response.json() == {"detail": "Rate limit exceeded"}


def test_security_api_key_rate_limit_disabled_by_default():
    """Test that rate limiting is disabled when max_requests is None."""
    unlimited_api_key = APIKeyHeader(name="key")
    unlimited_app = FastAPI()

    def get_current_user(oauth_header: str = Security(unlimited_api_key)):
        user = User(username=oauth_header)
        return user

    @unlimited_app.get("/users/me")
    def read_current_user(current_user: User = Depends(get_current_user)):
        return current_user

    unlimited_client = TestClient(unlimited_app)

    # Many requests should all succeed
    for _ in range(10):
        response = unlimited_client.get("/users/me", headers={"key": "secret"})
        assert response.status_code == 200, response.text


def test_security_api_key_rate_limit_per_key():
    """Test that rate limiting is per API key, not global."""
    per_key_api_key = APIKeyHeader(name="key", max_requests=2, window_seconds=60)
    per_key_app = FastAPI()

    def get_current_user(oauth_header: str = Security(per_key_api_key)):
        user = User(username=oauth_header)
        return user

    @per_key_app.get("/users/me")
    def read_current_user(current_user: User = Depends(get_current_user)):
        return current_user

    per_key_client = TestClient(per_key_app)

    # Key "secret1" uses 2 requests
    response = per_key_client.get("/users/me", headers={"key": "secret1"})
    assert response.status_code == 200, response.text
    response = per_key_client.get("/users/me", headers={"key": "secret1"})
    assert response.status_code == 200, response.text
    # Third request for "secret1" should fail
    response = per_key_client.get("/users/me", headers={"key": "secret1"})
    assert response.status_code == 429, response.text

    # Key "secret2" should still be allowed (separate counter)
    response = per_key_client.get("/users/me", headers={"key": "secret2"})
    assert response.status_code == 200, response.text
    response = per_key_client.get("/users/me", headers={"key": "secret2"})
    assert response.status_code == 200, response.text
    response = per_key_client.get("/users/me", headers={"key": "secret2"})
    assert response.status_code == 429, response.text
