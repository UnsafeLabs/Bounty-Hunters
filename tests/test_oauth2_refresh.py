import pytest
from fastapi.security import OAuth2PasswordBearer
from fastapi import Depends
from fastapi.testclient import TestClient
from fastapi import FastAPI

from fastapi.fastapi.security.oauth2 import (
    OAuth2PasswordBearerWithRefresh,
    OAuth2RefreshRequestForm,
)


def test_oauth2_password_bearer_standard():
    """Ensure the original OAuth2PasswordBearer behaviour is unchanged."""
    bearer = OAuth2PasswordBearer(tokenUrl="/token")
    assert bearer.tokenUrl == "/token"
    # The underlying OpenAPI model should contain a password flow with only tokenUrl
    model = bearer.model
    assert model.flows.password.tokenUrl == "/token"
    assert not hasattr(model.flows.password, "refreshUrl")


def test_oauth2_password_bearer_with_refresh():
    """The subclass must expose the refreshUrl in the OpenAPI schema."""
    bearer = OAuth2PasswordBearerWithRefresh(
        tokenUrl="/token", refresh_url="/refresh"
    )
    assert bearer.tokenUrl == "/token"
    assert bearer.refresh_url == "/refresh"
    model = bearer.model
    assert model.flows.password.tokenUrl == "/token"
    # The refreshUrl attribute is part of the OpenAPI spec
    assert getattr(model.flows.password, "refreshUrl", None) == "/refresh"


def test_oauth2_refresh_request_form_validation():
    """Form should only accept grant_type='refresh_token' and expose fields."""
    form = OAuth2RefreshRequestForm(
        grant_type="refresh_token",
        refresh_token="my-refresh-token",
        scope="read write",
        client_id="client123",
        client_secret="secret",
    )
    assert form.grant_type == "refresh_token"
    assert form.refresh_token == "my-refresh-token"
    assert form.scopes == ["read", "write"]
    assert form.client_id == "client123"
    assert form.client_secret == "secret"


def test_integration_refresh_endpoint():
    """Simple integration test that the dependency can be used in a FastAPI app."""
    app = FastAPI()

    oauth2_scheme = OAuth2PasswordBearerWithRefresh(
        tokenUrl="/token", refresh_url="/refresh"
    )

    @app.post("/token")
    async def token(form_data: Depends(OAuth2RefreshRequestForm)):
        # In a real app you would verify the refresh token and issue a new one.
        # Here we just echo back the received data for testing purposes.
        return {
            "grant_type": form_data.grant_type,
            "refresh_token": form_data.refresh_token,
            "scopes": form_data.scopes,
        }

    client = TestClient(app)

    response = client.post(
        "/token",
        data={
            "grant_type": "refresh_token",
            "refresh_token": "dummy",
            "scope": "read write",
        },
    )
    assert response.status_code == 200
    json = response.json()
    assert json["grant_type"] == "refresh_token"
    assert json["refresh_token"] == "dummy"
    assert json["scopes"] == ["read", "write"]
