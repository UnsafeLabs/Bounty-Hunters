from typing import Annotated

from fastapi import Depends, FastAPI, OAuth2RefreshRequestForm
from fastapi.security import (
    OAuth2PasswordBearer,
    OAuth2PasswordBearerWithRefresh,
)
from fastapi.testclient import TestClient


def test_oauth2_password_bearer_with_refresh_is_drop_in_dependency():
    app = FastAPI()
    oauth2_scheme = OAuth2PasswordBearerWithRefresh(
        tokenUrl="/token", refresh_url="/refresh"
    )

    @app.get("/users/me")
    def read_current_user(token: Annotated[str, Depends(oauth2_scheme)]):
        return {"token": token}

    client = TestClient(app)

    response = client.get(
        "/users/me", headers={"Authorization": "Bearer refreshed-access-token"}
    )

    assert response.status_code == 200
    assert response.json() == {"token": "refreshed-access-token"}


def test_oauth2_password_bearer_with_refresh_openapi_has_refresh_url():
    app = FastAPI()
    oauth2_scheme = OAuth2PasswordBearerWithRefresh(
        tokenUrl="/token",
        refresh_url="/refresh",
        scheme_name="OAuth2PasswordBearerWithRefresh",
        scopes={"items": "Read items"},
    )

    @app.get("/items/")
    def read_items(token: Annotated[str, Depends(oauth2_scheme)]):
        return {"token": token}

    client = TestClient(app)

    security_scheme = client.get("/openapi.json").json()["components"][
        "securitySchemes"
    ]["OAuth2PasswordBearerWithRefresh"]

    assert security_scheme["flows"]["password"] == {
        "scopes": {"items": "Read items"},
        "tokenUrl": "/token",
        "refreshUrl": "/refresh",
    }


def test_existing_oauth2_password_bearer_openapi_is_unchanged_without_refresh():
    app = FastAPI()
    oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/token")

    @app.get("/items/")
    def read_items(token: Annotated[str, Depends(oauth2_scheme)]):
        return {"token": token}

    client = TestClient(app)

    security_scheme = client.get("/openapi.json").json()["components"][
        "securitySchemes"
    ]["OAuth2PasswordBearer"]

    assert security_scheme["flows"]["password"] == {
        "scopes": {},
        "tokenUrl": "/token",
    }


def test_oauth2_refresh_request_form_accepts_refresh_token_grant():
    app = FastAPI()

    @app.post("/refresh")
    def refresh_token(
        form_data: Annotated[OAuth2RefreshRequestForm, Depends()],
    ):
        return {
            "grant_type": form_data.grant_type,
            "refresh_token": form_data.refresh_token,
            "scopes": form_data.scopes,
            "client_id": form_data.client_id,
            "client_secret": form_data.client_secret,
        }

    client = TestClient(app)

    response = client.post(
        "/refresh",
        data={
            "grant_type": "refresh_token",
            "refresh_token": "refresh-token-value",
            "scope": "items users",
            "client_id": "client-id",
            "client_secret": "client-secret",
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "grant_type": "refresh_token",
        "refresh_token": "refresh-token-value",
        "scopes": ["items", "users"],
        "client_id": "client-id",
        "client_secret": "client-secret",
    }


def test_oauth2_refresh_request_form_rejects_non_refresh_grant_type():
    app = FastAPI()

    @app.post("/refresh")
    def refresh_token(
        form_data: Annotated[OAuth2RefreshRequestForm, Depends()],
    ):
        return {"refresh_token": form_data.refresh_token}

    client = TestClient(app)

    response = client.post(
        "/refresh",
        data={
            "grant_type": "password",
            "refresh_token": "refresh-token-value",
        },
    )

    assert response.status_code == 422
    error = response.json()["detail"][0]
    assert error["loc"] == ["body", "grant_type"]
    assert error["type"] == "string_pattern_mismatch"


def test_oauth2_refresh_helpers_export_from_fastapi_package():
    from fastapi import (
        OAuth2PasswordBearerWithRefresh as PackageOAuth2PasswordBearerWithRefresh,
    )
    from fastapi import OAuth2RefreshRequestForm as PackageOAuth2RefreshRequestForm

    assert PackageOAuth2PasswordBearerWithRefresh is OAuth2PasswordBearerWithRefresh
    assert PackageOAuth2RefreshRequestForm is OAuth2RefreshRequestForm
