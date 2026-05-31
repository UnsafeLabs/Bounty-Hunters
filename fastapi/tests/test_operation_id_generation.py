import re

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient


def test_default_operation_id_includes_method_path_and_name():
    app = FastAPI()

    @app.post("/api/v1/items/{item_id}/meta-data")
    def update_item_metadata(item_id: str):
        return {"item_id": item_id}

    schema = TestClient(app).get("/openapi.json").json()

    operation_id = schema["paths"]["/api/v1/items/{item_id}/meta-data"]["post"][
        "operationId"
    ]
    assert operation_id == "post_api_v1_items_item_id_meta_data_update_item_metadata"
    assert re.fullmatch(r"[a-z0-9_]+", operation_id)


def test_default_operation_ids_are_unique_across_router_prefixes():
    app = FastAPI()
    api_v1 = APIRouter(prefix="/api/v1")
    api_v2 = APIRouter(prefix="/api/v2")

    @api_v1.get("/users", name="list_users")
    def list_users_v1():
        return []

    @api_v2.get("/users", name="list_users")
    def list_users_v2():
        return []

    app.include_router(api_v1)
    app.include_router(api_v2)

    schema = TestClient(app).get("/openapi.json").json()

    assert (
        schema["paths"]["/api/v1/users"]["get"]["operationId"]
        == "get_api_v1_users_list_users"
    )
    assert (
        schema["paths"]["/api/v2/users"]["get"]["operationId"]
        == "get_api_v2_users_list_users"
    )


def test_default_operation_id_for_root_routes_is_consistent():
    app = FastAPI()

    @app.get("/")
    def root():
        return {"ok": True}

    schema = TestClient(app).get("/openapi.json").json()

    assert schema["paths"]["/"]["get"]["operationId"] == "get_root"


def test_operation_id_collision_gets_numeric_suffix():
    app = FastAPI()

    @app.get("/reports/a-b", name="read_report")
    def read_report_hyphen():
        return {"report": "hyphen"}

    @app.get("/reports/a_b", name="read_report")
    def read_report_underscore():
        return {"report": "underscore"}

    with pytest.warns(UserWarning, match="Duplicate Operation ID"):
        schema = app.openapi()

    assert (
        schema["paths"]["/reports/a-b"]["get"]["operationId"]
        == "get_reports_a_b_read_report"
    )
    assert (
        schema["paths"]["/reports/a_b"]["get"]["operationId"]
        == "get_reports_a_b_read_report_2"
    )


def test_custom_generate_unique_id_function_is_unchanged():
    def custom_generate_unique_id(route: APIRoute) -> str:
        return f"custom_{route.name}"

    app = FastAPI(generate_unique_id_function=custom_generate_unique_id)

    @app.get("/items")
    def read_items():
        return []

    schema = TestClient(app).get("/openapi.json").json()

    assert schema["paths"]["/items"]["get"]["operationId"] == "custom_read_items"
