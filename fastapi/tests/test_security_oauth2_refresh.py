import pytest
from fastapi import (
    Depends,
    FastAPI,
    Security,
)
from fastapi import (
    OAuth2PasswordBearerWithRefresh as FastAPIOAuth2PasswordBearerWithRefresh,
)
from fastapi import (
    OAuth2RefreshRequestForm as FastAPIOAuth2RefreshRequestForm,
)
from fastapi.security import OAuth2PasswordBearerWithRefresh, OAuth2RefreshRequestForm
from fastapi.testclient import TestClient

app = FastAPI()

oauth2_scheme = OAuth2PasswordBearerWithRefresh(
    tokenUrl="/token",
    refresh_url="/token/refresh",
    scopes={"items": "Read items"},
    auto_error=False,
)


@app.get("/items/")
async def read_items(token: str | None = Security(oauth2_scheme)):
    if token is None:
        return {"msg": "Create an account first"}
    return {"token": token}


@app.post("/token/refresh")
async def refresh_token(form_data: OAuth2RefreshRequestForm = Depends()):
    return {
        "grant_type": form_data.grant_type,
        "refresh_token": form_data.refresh_token,
        "scopes": form_data.scopes,
        "client_id": form_data.client_id,
        "client_secret": form_data.client_secret,
    }


client = TestClient(app)


def test_security_exports():
    assert FastAPIOAuth2PasswordBearerWithRefresh is OAuth2PasswordBearerWithRefresh
    assert FastAPIOAuth2RefreshRequestForm is OAuth2RefreshRequestForm


def test_password_bearer_with_refresh_no_token():
    response = client.get("/items/")
    assert response.status_code == 200, response.text
    assert response.json() == {"msg": "Create an account first"}


def test_password_bearer_with_refresh_valid_token():
    response = client.get("/items/", headers={"Authorization": "Bearer testtoken"})
    assert response.status_code == 200, response.text
    assert response.json() == {"token": "testtoken"}


def test_password_bearer_with_refresh_rejects_wrong_scheme():
    response = client.get("/items/", headers={"Authorization": "Basic testtoken"})
    assert response.status_code == 200, response.text
    assert response.json() == {"msg": "Create an account first"}


def test_refresh_form_accepts_refresh_token_grant():
    response = client.post(
        "/token/refresh",
        data={
            "grant_type": "refresh_token",
            "refresh_token": "refresh-secret",
            "scope": "items profile",
            "client_id": "client-a",
            "client_secret": "secret-a",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json() == {
        "grant_type": "refresh_token",
        "refresh_token": "refresh-secret",
        "scopes": ["items", "profile"],
        "client_id": "client-a",
        "client_secret": "secret-a",
    }


@pytest.mark.parametrize(
    "grant_type",
    [
        pytest.param("password", id="password-grant"),
        pytest.param("refresh_token_extra", id="refresh-token-suffix"),
        pytest.param("extra_refresh_token", id="refresh-token-prefix"),
    ],
)
def test_refresh_form_rejects_invalid_grant_type(grant_type: str):
    response = client.post(
        "/token/refresh",
        data={"grant_type": grant_type, "refresh_token": "refresh-secret"},
    )
    assert response.status_code == 422
    assert response.json() == {
        "detail": [
            {
                "type": "string_pattern_mismatch",
                "loc": ["body", "grant_type"],
                "msg": "String should match pattern '^refresh_token$'",
                "input": grant_type,
                "ctx": {"pattern": "^refresh_token$"},
            }
        ]
    }


def test_openapi_schema_includes_refresh_url():
    response = client.get("/openapi.json")
    assert response.status_code == 200, response.text
    security_scheme = response.json()["components"]["securitySchemes"][
        "OAuth2PasswordBearerWithRefresh"
    ]
    assert security_scheme == {
        "type": "oauth2",
        "flows": {
            "password": {
                "scopes": {"items": "Read items"},
                "tokenUrl": "/token",
                "refreshUrl": "/token/refresh",
            }
        },
    }
