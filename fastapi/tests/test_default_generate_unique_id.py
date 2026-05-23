import re
import warnings

from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient


def test_default_generate_unique_id_includes_method_and_sanitized_path():
    app = FastAPI()
    api_v1 = APIRouter(prefix="/api/v1")
    api_v2 = APIRouter(prefix="/api-v2")

    @api_v1.get("/users/{user_id}", name="list_users")
    def list_users_v1(user_id: int):
        return {"user_id": user_id}  # pragma: no cover

    @api_v2.get("/users/{user_id}", name="list_users")
    def list_users_v2(user_id: int):
        return {"user_id": user_id}  # pragma: no cover

    app.include_router(api_v1)
    app.include_router(api_v2)

    openapi = TestClient(app).get("/openapi.json").json()
    operation_ids = [
        openapi["paths"]["/api/v1/users/{user_id}"]["get"]["operationId"],
        openapi["paths"]["/api-v2/users/{user_id}"]["get"]["operationId"],
    ]

    assert operation_ids == [
        "get_api_v1_users_user_id_list_users",
        "get_api_v2_users_user_id_list_users",
    ]
    assert all(re.fullmatch(r"[a-z0-9_]+", item) for item in operation_ids)


def test_default_generate_unique_id_appends_suffix_for_sanitized_collisions():
    app = FastAPI()

    @app.get("/items-alpha", name="list_items")
    def list_items_hyphen():
        return []  # pragma: no cover

    @app.get("/items_alpha", name="list_items")
    def list_items_underscore():
        return []  # pragma: no cover

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        openapi = TestClient(app).get("/openapi.json").json()

    assert (
        openapi["paths"]["/items-alpha"]["get"]["operationId"]
        == "get_items_alpha_list_items"
    )
    assert (
        openapi["paths"]["/items_alpha"]["get"]["operationId"]
        == "get_items_alpha_list_items_2"
    )
