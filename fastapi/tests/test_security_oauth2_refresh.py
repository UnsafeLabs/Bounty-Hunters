from fastapi import (
    Depends,
    FastAPI,
    OAuth2PasswordBearerWithRefresh,
    OAuth2RefreshRequestForm,
    Security,
)
from fastapi.security import (
    OAuth2PasswordBearerWithRefresh as SecurityOAuth2PasswordBearerWithRefresh,
)
from fastapi.security import (
    OAuth2RefreshRequestForm as SecurityOAuth2RefreshRequestForm,
)
from fastapi.testclient import TestClient

app = FastAPI()

oauth2_scheme = OAuth2PasswordBearerWithRefresh(
    tokenUrl="/token",
    refresh_url="/refresh",
    scopes={"items": "Read items"},
)


@app.get("/items/")
async def read_items(token: str = Security(oauth2_scheme)):
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


def test_root_and_security_exports():
    assert OAuth2PasswordBearerWithRefresh is SecurityOAuth2PasswordBearerWithRefresh
    assert OAuth2RefreshRequestForm is SecurityOAuth2RefreshRequestForm


def test_password_bearer_with_refresh_token():
    response = client.get("/items/", headers={"Authorization": "Bearer testtoken"})
    assert response.status_code == 200, response.text
    assert response.json() == {"token": "testtoken"}


def test_password_bearer_with_refresh_no_token():
    response = client.get("/items/")
    assert response.status_code == 401, response.text
    assert response.json() == {"detail": "Not authenticated"}
    assert response.headers["WWW-Authenticate"] == "Bearer"


def test_refresh_request_form():
    response = client.post(
        "/refresh",
        data={
            "grant_type": "refresh_token",
            "refresh_token": "refresh-token-value",
            "scope": "items profile",
            "client_id": "client-id",
            "client_secret": "client-secret",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json() == {
        "grant_type": "refresh_token",
        "refresh_token": "refresh-token-value",
        "scopes": ["items", "profile"],
        "client_id": "client-id",
        "client_secret": "client-secret",
    }


def test_refresh_request_form_rejects_other_grant_type():
    response = client.post(
        "/refresh",
        data={"grant_type": "password", "refresh_token": "refresh-token-value"},
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


def test_openapi_schema_includes_refresh_url():
    response = client.get("/openapi.json")
    assert response.status_code == 200, response.text
    openapi_schema = response.json()
    password_flow = openapi_schema["components"]["securitySchemes"][
        "OAuth2PasswordBearerWithRefresh"
    ]["flows"]["password"]
    assert password_flow == {
        "scopes": {"items": "Read items"},
        "tokenUrl": "/token",
        "refreshUrl": "/refresh",
    }
    refresh_schema = openapi_schema["components"]["schemas"][
        "Body_refresh_token_refresh_post"
    ]
    assert refresh_schema["required"] == ["grant_type", "refresh_token"]
    assert refresh_schema["properties"]["grant_type"]["pattern"] == "^refresh_token$"
