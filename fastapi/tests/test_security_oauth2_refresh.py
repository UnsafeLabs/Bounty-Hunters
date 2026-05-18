"""Tests for OAuth2 token refresh support."""
from typing import Annotated

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from fastapi.security import (
    OAuth2PasswordBearerWithRefresh,
    OAuth2RefreshRequestForm,
    OAuth2PasswordRequestForm,
)

# --- OAuth2RefreshRequestForm tests ---

def test_oauth2_refresh_request_form_basic():
    """Test that OAuth2RefreshRequestForm validates grant_type=refresh_token."""
    app = FastAPI()

    @app.post("/token/refresh")
    def refresh(form: Annotated[OAuth2RefreshRequestForm, Depends()]):
        return {
            "grant_type": form.grant_type,
            "refresh_token": form.refresh_token,
            "scopes": form.scopes,
        }

    client = TestClient(app)
    resp = client.post("/token/refresh", data={
        "grant_type": "refresh_token",
        "refresh_token": "test-refresh-token-123",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["grant_type"] == "refresh_token"
    assert data["refresh_token"] == "test-refresh-token-123"
    assert data["scopes"] == []


def test_oauth2_refresh_request_form_with_scopes():
    """Test that OAuth2RefreshRequestForm parses scopes."""
    app = FastAPI()

    @app.post("/token/refresh")
    def refresh(form: Annotated[OAuth2RefreshRequestForm, Depends()]):
        return {"scopes": form.scopes}

    client = TestClient(app)
    resp = client.post("/token/refresh", data={
        "grant_type": "refresh_token",
        "refresh_token": "token",
        "scope": "read write admin",
    })
    assert resp.status_code == 200
    assert resp.json()["scopes"] == ["read", "write", "admin"]


def test_oauth2_refresh_request_form_rejects_wrong_grant_type():
    """Test that OAuth2RefreshRequestForm rejects non-refresh_token grant_type."""
    app = FastAPI()

    @app.post("/token/refresh")
    def refresh(form: Annotated[OAuth2RefreshRequestForm, Depends()]):
        return {"grant_type": form.grant_type}

    client = TestClient(app)
    resp = client.post("/token/refresh", data={
        "grant_type": "password",
        "refresh_token": "token",
    })
    assert resp.status_code == 422  # Validation error


def test_oauth2_refresh_request_form_with_client_credentials():
    """Test that OAuth2RefreshRequestForm accepts optional client_id/secret."""
    app = FastAPI()

    @app.post("/token/refresh")
    def refresh(form: Annotated[OAuth2RefreshRequestForm, Depends()]):
        return {
            "client_id": form.client_id,
            "client_secret": form.client_secret,
        }

    client = TestClient(app)
    resp = client.post("/token/refresh", data={
        "grant_type": "refresh_token",
        "refresh_token": "token",
        "client_id": "my-client",
        "client_secret": "my-secret",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["client_id"] == "my-client"
    assert data["client_secret"] == "my-secret"


# --- OAuth2PasswordBearerWithRefresh tests ---

def test_oauth2_password_bearer_with_refresh_openapi_schema():
    """Test that OAuth2PasswordBearerWithRefresh includes refreshUrl in OpenAPI schema."""
    app = FastAPI()

    oauth2_scheme = OAuth2PasswordBearerWithRefresh(
        tokenUrl="/token",
        refreshUrl="/token/refresh",
    )

    @app.get("/protected")
    def protected(token: Annotated[str, Depends(oauth2_scheme)]):
        return {"token": token}

    client = TestClient(app)
    resp = client.get("/openapi.json")
    assert resp.status_code == 200
    schema = resp.json()

    # Check that the security scheme includes refreshUrl
    security_schemes = schema.get("components", {}).get("securitySchemes", {})
    scheme = security_schemes.get("OAuth2PasswordBearerWithRefresh")
    assert scheme is not None
    assert scheme["type"] == "oauth2"
    assert "password" in scheme["flows"]
    assert scheme["flows"]["password"]["tokenUrl"] == "/token"
    assert scheme["flows"]["password"]["refreshUrl"] == "/token/refresh"


def test_oauth2_password_bearer_with_refresh_auth():
    """Test that OAuth2PasswordBearerWithRefresh works as a drop-in replacement."""
    app = FastAPI()

    oauth2_scheme = OAuth2PasswordBearerWithRefresh(
        tokenUrl="/token",
        refreshUrl="/token/refresh",
    )

    @app.get("/protected")
    def protected(token: Annotated[str, Depends(oauth2_scheme)]):
        return {"token": token}

    client = TestClient(app)

    # Without auth - should fail
    resp = client.get("/protected")
    assert resp.status_code == 401

    # With valid bearer token
    resp = client.get("/protected", headers={"Authorization": "Bearer test-token-123"})
    assert resp.status_code == 200
    assert resp.json()["token"] == "test-token-123"


def test_oauth2_password_bearer_with_refresh_scopes():
    """Test that OAuth2PasswordBearerWithRefresh supports scopes."""
    app = FastAPI()

    oauth2_scheme = OAuth2PasswordBearerWithRefresh(
        tokenUrl="/token",
        refreshUrl="/token/refresh",
        scopes={"read": "Read access", "write": "Write access"},
    )

    @app.get("/protected")
    def protected(token: Annotated[str, Depends(oauth2_scheme)]):
        return {"token": token}

    client = TestClient(app)
    resp = client.get("/openapi.json")
    schema = resp.json()

    scheme = schema["components"]["securitySchemes"]["OAuth2PasswordBearerWithRefresh"]
    assert scheme["flows"]["password"]["scopes"] == {"read": "Read access", "write": "Write access"}


def test_oauth2_password_bearer_with_refresh_auto_error_false():
    """Test that auto_error=False returns None instead of raising."""
    app = FastAPI()

    oauth2_scheme = OAuth2PasswordBearerWithRefresh(
        tokenUrl="/token",
        refreshUrl="/token/refresh",
        auto_error=False,
    )

    @app.get("/optional")
    def optional(token: Annotated[str | None, Depends(oauth2_scheme)]):
        return {"token": token}

    client = TestClient(app)
    resp = client.get("/optional")
    assert resp.status_code == 200
    assert resp.json()["token"] is None


def test_existing_oauth2_password_bearer_unchanged():
    """Test that existing OAuth2PasswordBearer behavior is not modified."""
    from fastapi.security import OAuth2PasswordBearer

    app = FastAPI()

    oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/token")

    @app.get("/protected")
    def protected(token: Annotated[str, Depends(oauth2_scheme)]):
        return {"token": token}

    client = TestClient(app)

    # Without auth - should fail
    resp = client.get("/protected")
    assert resp.status_code == 401

    # With valid bearer token
    resp = client.get("/protected", headers={"Authorization": "Bearer old-style-token"})
    assert resp.status_code == 200
    assert resp.json()["token"] == "old-style-token"

    # Check OpenAPI schema - refreshUrl defaults to None and is excluded from output
    resp = client.get("/openapi.json")
    schema = resp.json()
    scheme = schema["components"]["securitySchemes"]["OAuth2PasswordBearer"]
    # When refreshUrl is None (default), Pydantic excludes it from the OpenAPI output
    assert "refreshUrl" not in scheme["flows"]["password"]


def test_existing_oauth2_password_request_form_unchanged():
    """Test that existing OAuth2PasswordRequestForm behavior is not modified."""
    app = FastAPI()

    @app.post("/token")
    def login(form: Annotated[OAuth2PasswordRequestForm, Depends()]):
        return {
            "grant_type": form.grant_type,
            "username": form.username,
            "scopes": form.scopes,
        }

    client = TestClient(app)
    resp = client.post("/token", data={
        "grant_type": "password",
        "username": "user",
        "password": "pass",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["grant_type"] == "password"
    assert data["username"] == "user"
