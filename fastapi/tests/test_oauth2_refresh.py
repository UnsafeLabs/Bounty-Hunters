from typing import Annotated

import fastapi
from fastapi import Depends, FastAPI, Security
from fastapi.security import (
    OAuth2PasswordBearer,
    OAuth2PasswordBearerWithRefresh,
    OAuth2RefreshRequestForm,
)
from fastapi.testclient import TestClient


app = FastAPI()

oauth2_standard = OAuth2PasswordBearer(tokenUrl="/token")
oauth2_with_refresh = OAuth2PasswordBearerWithRefresh(
    tokenUrl="/token",
    refresh_url="/refresh",
    scopes={"items": "Read items"},
)


@app.get("/standard")
def read_standard(token: Annotated[str, Security(oauth2_standard)]):
    return {"token": token}


@app.get("/with-refresh")
def read_with_refresh(token: Annotated[str, Security(oauth2_with_refresh)]):
    return {"token": token}


@app.post("/refresh")
def refresh(form_data: Annotated[OAuth2RefreshRequestForm, Depends()]):
    return {
        "grant_type": form_data.grant_type,
        "refresh_token": form_data.refresh_token,
        "scopes": form_data.scopes,
        "client_id": form_data.client_id,
        "client_secret": form_data.client_secret,
    }


client = TestClient(app)


def test_oauth2_password_bearer_with_refresh_is_drop_in():
    response = client.get(
        "/with-refresh", headers={"Authorization": "Bearer refreshed-token"}
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"token": "refreshed-token"}


def test_oauth2_password_bearer_with_refresh_openapi():
    response = client.get("/openapi.json")
    assert response.status_code == 200, response.text
    schemes = response.json()["components"]["securitySchemes"]

    standard_flow = schemes["OAuth2PasswordBearer"]["flows"]["password"]
    refresh_flow = schemes["OAuth2PasswordBearerWithRefresh"]["flows"]["password"]

    assert "refreshUrl" not in standard_flow
    assert refresh_flow["tokenUrl"] == "/token"
    assert refresh_flow["refreshUrl"] == "/refresh"
    assert refresh_flow["scopes"] == {"items": "Read items"}


def test_oauth2_refresh_request_form():
    response = client.post(
        "/refresh",
        data={
            "grant_type": "refresh_token",
            "refresh_token": "refresh-secret",
            "scope": "items profile",
            "client_id": "client",
            "client_secret": "secret",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json() == {
        "grant_type": "refresh_token",
        "refresh_token": "refresh-secret",
        "scopes": ["items", "profile"],
        "client_id": "client",
        "client_secret": "secret",
    }


def test_oauth2_refresh_request_form_rejects_wrong_grant_type():
    response = client.post(
        "/refresh",
        data={"grant_type": "password", "refresh_token": "refresh-secret"},
    )
    assert response.status_code == 422
    assert response.json()["detail"] == [
        {
            "type": "string_pattern_mismatch",
            "loc": ["body", "grant_type"],
            "msg": "String should match pattern '^refresh_token$'",
            "input": "password",
            "ctx": {"pattern": "^refresh_token$"},
        }
    ]


def test_oauth2_refresh_exports_from_root_package():
    assert fastapi.OAuth2PasswordBearerWithRefresh is OAuth2PasswordBearerWithRefresh
    assert fastapi.OAuth2RefreshRequestForm is OAuth2RefreshRequestForm
