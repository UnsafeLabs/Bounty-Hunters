from fastapi import Depends, FastAPI, Security
from fastapi import (
    OAuth2PasswordBearerWithRefresh as RootOAuth2PasswordBearerWithRefresh,
)
from fastapi import OAuth2RefreshRequestForm as RootOAuth2RefreshRequestForm
from fastapi.security import (
    OAuth2PasswordBearer,
    OAuth2PasswordBearerWithRefresh,
    OAuth2RefreshRequestForm,
)
from fastapi.testclient import TestClient

app = FastAPI()

oauth2_scheme = OAuth2PasswordBearerWithRefresh(
    tokenUrl="/token",
    refresh_url="/token/refresh",
    scopes={"me": "Read current user"},
)


@app.get("/users/me")
def read_current_user(token: str = Security(oauth2_scheme, scopes=["me"])):
    return {"token": token}


@app.post("/token/refresh")
def refresh_token(form_data: OAuth2RefreshRequestForm = Depends()):
    return {
        "grant_type": form_data.grant_type,
        "refresh_token": form_data.refresh_token,
        "scopes": form_data.scopes,
        "client_id": form_data.client_id,
        "client_secret": form_data.client_secret,
    }


client = TestClient(app)


def test_oauth2_password_bearer_with_refresh_exports():
    assert RootOAuth2PasswordBearerWithRefresh is OAuth2PasswordBearerWithRefresh
    assert RootOAuth2RefreshRequestForm is OAuth2RefreshRequestForm


def test_oauth2_password_bearer_with_refresh_is_drop_in_bearer():
    response = client.get("/users/me", headers={"Authorization": "Bearer refreshed"})
    assert response.status_code == 200, response.text
    assert response.json() == {"token": "refreshed"}


def test_oauth2_password_bearer_with_refresh_missing_header():
    response = client.get("/users/me")
    assert response.status_code == 401, response.text
    assert response.json() == {"detail": "Not authenticated"}
    assert response.headers["WWW-Authenticate"] == "Bearer"


def test_oauth2_password_bearer_with_refresh_openapi_schema():
    response = client.get("/openapi.json")
    assert response.status_code == 200, response.text
    scheme = response.json()["components"]["securitySchemes"][
        "OAuth2PasswordBearerWithRefresh"
    ]

    assert scheme["type"] == "oauth2"
    assert scheme["flows"]["password"] == {
        "scopes": {"me": "Read current user"},
        "tokenUrl": "/token",
        "refreshUrl": "/token/refresh",
    }


def test_oauth2_refresh_request_form():
    response = client.post(
        "/token/refresh",
        data={
            "grant_type": "refresh_token",
            "refresh_token": "refresh-token-value",
            "scope": "me items",
            "client_id": "client",
            "client_secret": "secret",
        },
    )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "grant_type": "refresh_token",
        "refresh_token": "refresh-token-value",
        "scopes": ["me", "items"],
        "client_id": "client",
        "client_secret": "secret",
    }


def test_oauth2_refresh_request_form_rejects_other_grant_type():
    response = client.post(
        "/token/refresh",
        data={"grant_type": "password", "refresh_token": "refresh-token-value"},
    )

    assert response.status_code == 422, response.text
    assert response.json()["detail"][0]["type"] == "string_pattern_mismatch"
    assert response.json()["detail"][0]["loc"] == ["body", "grant_type"]


def test_standard_oauth2_password_bearer_refresh_url_default_is_unchanged():
    standard_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/token")

    assert standard_oauth2_scheme.model.flows.password is not None
    assert standard_oauth2_scheme.model.flows.password.refreshUrl is None
