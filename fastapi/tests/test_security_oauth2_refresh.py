from typing import Annotated

from fastapi import Depends, FastAPI, Security
from fastapi.security import OAuth2PasswordBearerWithRefresh, OAuth2RefreshRequestForm
from fastapi.testclient import TestClient
from inline_snapshot import snapshot

app = FastAPI()

oauth2_scheme = OAuth2PasswordBearerWithRefresh(
    tokenUrl="/token",
    refresh_url="/token/refresh",
    scopes={"items": "Read items"},
)


@app.get("/items/")
async def read_items(token: str = Security(oauth2_scheme)):
    return {"token": token}


@app.post("/token/refresh")
async def refresh_token(form_data: Annotated[OAuth2RefreshRequestForm, Depends()]):
    return {
        "grant_type": form_data.grant_type,
        "refresh_token": form_data.refresh_token,
        "scopes": form_data.scopes,
        "client_id": form_data.client_id,
        "client_secret": form_data.client_secret,
    }


client = TestClient(app)


def test_refresh_request_form():
    response = client.post(
        "/token/refresh",
        data={
            "grant_type": "refresh_token",
            "refresh_token": "refresh-123",
            "scope": "items profile",
            "client_id": "client",
            "client_secret": "secret",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json() == {
        "grant_type": "refresh_token",
        "refresh_token": "refresh-123",
        "scopes": ["items", "profile"],
        "client_id": "client",
        "client_secret": "secret",
    }


def test_refresh_request_form_rejects_wrong_grant_type():
    response = client.post(
        "/token/refresh",
        data={"grant_type": "password", "refresh_token": "refresh-123"},
    )
    assert response.status_code == 422, response.text


def test_bearer_token():
    response = client.get("/items/", headers={"Authorization": "Bearer access-123"})
    assert response.status_code == 200, response.text
    assert response.json() == {"token": "access-123"}


def test_openapi_schema_includes_refresh_url():
    response = client.get("/openapi.json")
    assert response.status_code == 200, response.text
    assert response.json()["components"]["securitySchemes"] == snapshot(
        {
            "OAuth2PasswordBearerWithRefresh": {
                "type": "oauth2",
                "flows": {
                    "password": {
                        "scopes": {"items": "Read items"},
                        "tokenUrl": "/token",
                        "refreshUrl": "/token/refresh",
                    }
                },
            }
        }
    )
