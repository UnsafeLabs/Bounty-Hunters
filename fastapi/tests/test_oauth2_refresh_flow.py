from fastapi import (
    Depends,
    FastAPI,
    OAuth2PasswordBearerWithRefresh,
    OAuth2RefreshRequestForm,
    Security,
)
from fastapi.testclient import TestClient

app = FastAPI()

oauth2_scheme = OAuth2PasswordBearerWithRefresh(
    tokenUrl="/token",
    refresh_url="/refresh",
    scopes={"items:read": "Read items"},
    auto_error=False,
)


@app.get("/items/")
async def read_items(token: str | None = Security(oauth2_scheme)):
    if token is None:
        return {"token": None}
    return {"token": token}


@app.post("/refresh")
async def refresh_token(form_data: OAuth2RefreshRequestForm = Depends()):
    return {
        "grant_type": form_data.grant_type,
        "refresh_token": form_data.refresh_token,
        "scopes": form_data.scopes,
        "client_id": form_data.client_id,
        "client_secret": form_data.client_secret,
    }


client = TestClient(app)


def test_oauth2_password_bearer_with_refresh_is_drop_in_bearer():
    response = client.get("/items/", headers={"Authorization": "Bearer access-token"})

    assert response.status_code == 200
    assert response.json() == {"token": "access-token"}


def test_oauth2_password_bearer_with_refresh_can_be_optional():
    response = client.get("/items/")

    assert response.status_code == 200
    assert response.json() == {"token": None}


def test_oauth2_password_bearer_with_refresh_openapi_schema():
    response = client.get("/openapi.json")

    assert response.status_code == 200, response.text
    security_scheme = response.json()["components"]["securitySchemes"][
        "OAuth2PasswordBearerWithRefresh"
    ]
    assert security_scheme["type"] == "oauth2"
    assert security_scheme["flows"]["password"] == {
        "refreshUrl": "/refresh",
        "scopes": {"items:read": "Read items"},
        "tokenUrl": "/token",
    }


def test_oauth2_refresh_request_form_parses_refresh_token_request():
    response = client.post(
        "/refresh",
        data={
            "grant_type": "refresh_token",
            "refresh_token": "refresh-token",
            "scope": "items:read items:write",
            "client_id": "client-a",
            "client_secret": "secret-a",
        },
    )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "grant_type": "refresh_token",
        "refresh_token": "refresh-token",
        "scopes": ["items:read", "items:write"],
        "client_id": "client-a",
        "client_secret": "secret-a",
    }


def test_oauth2_refresh_request_form_rejects_wrong_grant_type():
    response = client.post(
        "/refresh",
        data={"grant_type": "password", "refresh_token": "refresh-token"},
    )

    assert response.status_code == 422
    assert "refresh_token" in response.text
