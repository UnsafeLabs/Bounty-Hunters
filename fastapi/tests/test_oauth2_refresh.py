"""Tests for OAuth2PasswordBearerWithRefresh and OAuth2RefreshRequestForm."""

from typing import Annotated

import pytest
from fastapi import Depends, FastAPI
from fastapi.security import (
    OAuth2PasswordBearerWithRefresh,
    OAuth2RefreshRequestForm,
)
from fastapi.testclient import TestClient


class TestOAuth2PasswordBearerWithRefresh:
    def test_drop_in_replacement(self):
        """Should work as a drop-in replacement for OAuth2PasswordBearer."""
        oauth2 = OAuth2PasswordBearerWithRefresh(tokenUrl="/token")
        assert oauth2.scheme_name == "OAuth2PasswordBearerWithRefresh"

    def test_refresh_url_in_openapi(self):
        """refreshUrl should appear in the OpenAPI schema."""
        app = FastAPI()

        @app.get("/protected")
        async def protected(token: Annotated[str, Depends(
            OAuth2PasswordBearerWithRefresh(tokenUrl="/token", refreshUrl="/refresh")
        )]):
            return {"token": token}

        client = TestClient(app)
        response = client.get("/openapi.json")
        schema = response.json()
        # Check that refreshUrl is in the security scheme
        security_schemes = schema.get("components", {}).get("securitySchemes", {})
        scheme = security_schemes.get("OAuth2PasswordBearerWithRefresh", {})
        password_flow = scheme.get("flows", {}).get("password", {})
        assert password_flow.get("refreshUrl") == "/refresh"

    def test_existing_behavior_not_modified(self):
        """Existing OAuth2PasswordBearer should still work the same."""
        oauth2 = OAuth2PasswordBearerWithRefresh(tokenUrl="/token")
        assert oauth2.auto_error is True

    def test_no_refresh_url(self):
        """Should work without refreshUrl (defaults to None)."""
        oauth2 = OAuth2PasswordBearerWithRefresh(tokenUrl="/token")
        assert oauth2.model.flows.password.refreshUrl is None

    def test_extract_token_from_header(self):
        """Should extract bearer token from Authorization header."""
        app = FastAPI()
        oauth2 = OAuth2PasswordBearerWithRefresh(
            tokenUrl="/token", refreshUrl="/refresh"
        )

        @app.get("/protected")
        async def protected(token: Annotated[str, Depends(oauth2)]):
            return {"token": token}

        client = TestClient(app)
        response = client.get(
            "/protected", headers={"Authorization": "Bearer testtoken123"}
        )
        assert response.status_code == 200
        assert response.json() == {"token": "testtoken123"}

    def test_missing_token_auto_error(self):
        """Should return 401 when no Authorization header and auto_error=True."""
        app = FastAPI()
        oauth2 = OAuth2PasswordBearerWithRefresh(
            tokenUrl="/token", auto_error=True
        )

        @app.get("/protected")
        async def protected(token: Annotated[str, Depends(oauth2)]):
            return {"token": token}

        client = TestClient(app)
        response = client.get("/protected")
        assert response.status_code == 401

    def test_missing_token_no_auto_error(self):
        """Should return None when no Authorization header and auto_error=False."""
        app = FastAPI()
        oauth2 = OAuth2PasswordBearerWithRefresh(
            tokenUrl="/token", auto_error=False
        )

        @app.get("/protected")
        async def protected(token: Annotated[str | None, Depends(oauth2)]):
            return {"token": token}

        client = TestClient(app)
        response = client.get("/protected")
        assert response.status_code == 200
        assert response.json() == {"token": None}


class TestOAuth2RefreshRequestForm:
    def test_form_basic(self):
        """Should accept refresh_token and optional grant_type."""
        form = OAuth2RefreshRequestForm(refresh_token="mytoken123")
        assert form.refresh_token == "mytoken123"
        assert form.scopes == []
        assert form.client_id is None
        assert form.client_secret is None

    def test_form_with_scopes(self):
        """Should parse scopes from space-separated string."""
        form = OAuth2RefreshRequestForm(
            refresh_token="token", scope="read write admin"
        )
        assert form.scopes == ["read", "write", "admin"]

    def test_form_with_client_credentials(self):
        form = OAuth2RefreshRequestForm(
            refresh_token="token",
            client_id="myclient",
            client_secret="mysecret",
        )
        assert form.client_id == "myclient"
        assert form.client_secret == "mysecret"

    def test_form_grant_type_validation(self):
        """grant_type should validate as refresh_token."""
        # Valid: refresh_token
        form = OAuth2RefreshRequestForm(
            grant_type="refresh_token", refresh_token="token"
        )
        assert form.grant_type == "refresh_token"

    def test_form_as_dependency(self):
        """Should work as a FastAPI dependency."""
        try:
            from python_multipart import __version__
            assert __version__ > "0.0.12"
        except (ImportError, AssertionError):
            pytest.skip("python-multipart not properly installed")

        app = FastAPI()

        @app.post("/refresh")
        async def refresh(
            form_data: Annotated[OAuth2RefreshRequestForm, Depends()],
        ):
            return {
                "refresh_token": form_data.refresh_token,
                "grant_type": form_data.grant_type,
                "scopes": form_data.scopes,
            }

        client = TestClient(app)
        response = client.post(
            "/refresh",
            data={
                "grant_type": "refresh_token",
                "refresh_token": "myrefresh123",
                "scope": "read write",
            },
        )
        assert response.status_code == 200
        assert response.json() == {
            "refresh_token": "myrefresh123",
            "grant_type": "refresh_token",
            "scopes": ["read", "write"],
        }

    def test_form_empty_scope(self):
        """Empty scope should result in empty list."""
        form = OAuth2RefreshRequestForm(refresh_token="token", scope="")
        assert form.scopes == []
