"""Tests for OAuth2 token refresh support."""
import pytest
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.testclient import TestClient
from fastapi.security.oauth2 import OAuth2PasswordRequestForm

from fastapi.security.oauth2_refresh import (
    OAuth2PasswordBearerWithRefresh,
    OAuth2RefreshRequestForm,
    create_token_response,
)


@pytest.fixture
def app():
    app = FastAPI()
    oauth2_scheme = OAuth2PasswordBearerWithRefresh(
        tokenUrl="/token",
        refreshUrl="/refresh",
    )

    @app.post("/token")
    async def login(form: OAuth2PasswordRequestForm = Depends()):
        if form.username == "user" and form.password == "pass":
            return create_token_response(
                access_token="access_123",
                refresh_token="refresh_456",
                expires_in=3600,
            )
        raise HTTPException(status_code=400, detail="Invalid credentials")

    @app.post("/refresh")
    async def refresh(form: OAuth2RefreshRequestForm = Depends()):
        if form.refresh_token == "refresh_456":
            return create_token_response(
                access_token="access_789",
                refresh_token="refresh_012",
                expires_in=3600,
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )

    @app.get("/protected")
    async def protected(token: str = Depends(oauth2_scheme)):
        return {"token": token}

    return app


@pytest.fixture
def client(app):
    return TestClient(app)


class TestOAuth2RefreshRequestForm:
    def test_valid_refresh_form(self):
        form = OAuth2RefreshRequestForm(refresh_token="abc123")
        assert form.grant_type == "refresh_token"
        assert form.refresh_token == "abc123"

    def test_invalid_grant_type(self):
        with pytest.raises(Exception):
            OAuth2RefreshRequestForm(grant_type="password", refresh_token="abc123")


class TestOAuth2PasswordBearerWithRefresh:
    def test_has_refresh_url(self):
        scheme = OAuth2PasswordBearerWithRefresh(
            tokenUrl="/token",
            refreshUrl="/refresh",
        )
        assert scheme.refresh_url == "/refresh"

    def test_default_refresh_url_is_token_url(self):
        scheme = OAuth2PasswordBearerWithRefresh(tokenUrl="/token")
        assert scheme.refresh_url == "/token"


class TestCreateTokenResponse:
    def test_minimal_response(self):
        resp = create_token_response("access", "refresh")
        assert resp["access_token"] == "access"
        assert resp["refresh_token"] == "refresh"
        assert resp["token_type"] == "bearer"

    def test_full_response(self):
        resp = create_token_response(
            "access", "refresh", expires_in=3600, scope="read write"
        )
        assert resp["expires_in"] == 3600
        assert resp["scope"] == "read write"


class TestEndpoints:
    def test_login(self, client):
        resp = client.post("/token", data={
            "grant_type": "password",
            "username": "user",
            "password": "pass",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["access_token"] == "access_123"
        assert data["refresh_token"] == "refresh_456"

    def test_refresh(self, client):
        resp = client.post("/refresh", data={
            "grant_type": "refresh_token",
            "refresh_token": "refresh_456",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["access_token"] == "access_789"

    def test_invalid_refresh_token(self, client):
        resp = client.post("/refresh", data={
            "grant_type": "refresh_token",
            "refresh_token": "invalid",
        })
        assert resp.status_code == 401
