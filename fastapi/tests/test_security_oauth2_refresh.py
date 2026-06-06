import pytest
from fastapi import Depends, FastAPI, Security
from fastapi.security import OAuth2PasswordBearerWithRefresh, OAuth2RefreshRequestForm
from fastapi.testclient import TestClient

app = FastAPI()

oauth2_scheme = OAuth2PasswordBearerWithRefresh(
    tokenUrl="/token",
    refresh_url="/refresh",
    scopes={"items": "Read items"},
)


@app.get("/items/")
def read_items(token: str = Security(oauth2_scheme)):
    return {"token": token}


@app.post("/refresh")
def refresh_token(form_data: OAuth2RefreshRequestForm = Depends()):
    return {
        "grant_type": form_data.grant_type,
        "refresh_token": form_data.refresh_token,
        "scopes": form_data.scopes,
        "client_id": form_data.client_id,
        "client_secret": form_data.client_secret,
    }


client = TestClient(app)


def test_oauth2_password_bearer_with_refresh_reads_bearer_token():
    response = client.get("/items/", headers={"Authorization": "Bearer fresh-token"})
    assert response.status_code == 200
    assert response.json() == {"token": "fresh-token"}


def test_oauth2_password_bearer_with_refresh_openapi_schema():
    response = client.get("/openapi.json")
    assert response.status_code == 200
    security_scheme = response.json()["components"]["securitySchemes"][
        "OAuth2PasswordBearerWithRefresh"
    ]
    assert security_scheme == {
        "type": "oauth2",
        "flows": {
            "password": {
                "scopes": {"items": "Read items"},
                "tokenUrl": "/token",
                "refreshUrl": "/refresh",
            }
        },
    }


def test_oauth2_refresh_request_form_accepts_refresh_token_grant():
    response = client.post(
        "/refresh",
        data={
            "grant_type": "refresh_token",
            "refresh_token": "refresh-123",
            "scope": "items users",
            "client_id": "client-a",
            "client_secret": "secret-a",
        },
    )
    assert response.status_code == 200
    assert response.json() == {
        "grant_type": "refresh_token",
        "refresh_token": "refresh-123",
        "scopes": ["items", "users"],
        "client_id": "client-a",
        "client_secret": "secret-a",
    }


@pytest.mark.parametrize("grant_type", ["password", "refresh_token_extra"])
def test_oauth2_refresh_request_form_rejects_wrong_grant_type(grant_type: str):
    response = client.post(
        "/refresh",
        data={"grant_type": grant_type, "refresh_token": "refresh-123"},
    )
    assert response.status_code == 422
    error = response.json()["detail"][0]
    assert error["loc"] == ["body", "grant_type"]
    assert error["type"] == "string_pattern_mismatch"
