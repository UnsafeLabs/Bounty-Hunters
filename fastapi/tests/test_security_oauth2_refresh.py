from fastapi import Depends, FastAPI, Security
from fastapi.security import (
    OAuth2PasswordBearer,
    OAuth2PasswordBearerWithRefresh,
    OAuth2RefreshRequestForm,
)
from fastapi.testclient import TestClient

app = FastAPI()

oauth2_scheme = OAuth2PasswordBearerWithRefresh(
    tokenUrl="token",
    refresh_url="token/refresh",
    scopes={"items:read": "Read items"},
)
standard_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="legacy-token")


@app.post("/refresh")
def refresh_token(form_data: OAuth2RefreshRequestForm = Depends()):
    return form_data


@app.get("/users/me")
def read_current_user(token: str | None = Security(oauth2_scheme)):
    return {"token": token}


@app.get("/legacy")
def read_legacy_token(token: str | None = Security(standard_oauth2_scheme)):
    return {"token": token}


client = TestClient(app)


def test_token():
    response = client.get("/users/me", headers={"Authorization": "Bearer testtoken"})
    assert response.status_code == 200, response.text
    assert response.json() == {"token": "testtoken"}


def test_standard_password_bearer_behavior_is_unchanged():
    response = client.get("/legacy", headers={"Authorization": "Bearer legacytoken"})
    assert response.status_code == 200, response.text
    assert response.json() == {"token": "legacytoken"}


def test_refresh_form():
    response = client.post(
        "/refresh",
        data={
            "grant_type": "refresh_token",
            "refresh_token": "refresh-token-value",
            "scope": "items:read profile",
            "client_id": "client",
            "client_secret": "secret",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json() == {
        "grant_type": "refresh_token",
        "refresh_token": "refresh-token-value",
        "scopes": ["items:read", "profile"],
        "client_id": "client",
        "client_secret": "secret",
    }


def test_refresh_form_rejects_wrong_grant_type():
    response = client.post(
        "/refresh",
        data={"grant_type": "password", "refresh_token": "refresh-token-value"},
    )
    assert response.status_code == 422
    assert response.json()["detail"][0]["type"] == "string_pattern_mismatch"
    assert response.json()["detail"][0]["ctx"] == {"pattern": "^refresh_token$"}


def test_openapi_schema():
    response = client.get("/openapi.json")
    assert response.status_code == 200, response.text
    assert response.json()["components"]["securitySchemes"][
        "OAuth2PasswordBearerWithRefresh"
    ]["flows"]["password"] == {
        "refreshUrl": "token/refresh",
        "scopes": {"items:read": "Read items"},
        "tokenUrl": "token",
    }
