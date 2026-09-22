import importlib.util
from pathlib import Path

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient


MODULE_PATH = Path(__file__).parents[1] / "fastapi/fastapi/security/oauth2.py"
spec = importlib.util.spec_from_file_location("refresh_oauth2", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


def test_refresh_url_is_emitted_in_openapi_and_bearer_is_unchanged():
    app = FastAPI()
    security = module.OAuth2PasswordBearerWithRefresh(
        tokenUrl="/token", refresh_url="/refresh"
    )

    @app.get("/items")
    async def items(token: str = Depends(security)):
        return {"token": token}

    scheme = app.openapi()["components"]["securitySchemes"][
        "OAuth2PasswordBearerWithRefresh"
    ]
    assert scheme["flows"]["password"] == {
        "tokenUrl": "/token",
        "refreshUrl": "/refresh",
        "scopes": {},
    }

    response = TestClient(app).get("/items", headers={"Authorization": "Bearer abc"})
    assert response.json() == {"token": "abc"}


def test_refresh_form_accepts_refresh_token_and_splits_scopes():
    form = module.OAuth2RefreshRequestForm(
        grant_type="refresh_token", refresh_token="r1", scope="read write"
    )
    assert form.refresh_token == "r1"
    assert form.scopes == ["read", "write"]


def test_refresh_form_rejects_other_grant_types():
    with pytest.raises(ValueError, match="refresh_token"):
        module.OAuth2RefreshRequestForm(grant_type="password", refresh_token="r1")
