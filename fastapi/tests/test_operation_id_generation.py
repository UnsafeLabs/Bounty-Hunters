import warnings

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient


def test_default_operation_ids_include_method_path_and_function_name() -> None:
    app = FastAPI()
    v1 = APIRouter()
    v2 = APIRouter()

    def list_users() -> dict[str, bool]:
        return {"ok": True}

    v1.add_api_route("/users", list_users, methods=["GET"])
    v2.add_api_route("/users", list_users, methods=["GET"])
    app.include_router(v1, prefix="/api/v1")
    app.include_router(v2, prefix="/api/v2")

    openapi = TestClient(app).get("/openapi.json").json()

    assert openapi["paths"]["/api/v1/users"]["get"]["operationId"] == (
        "get_api_v1_users_list_users"
    )
    assert openapi["paths"]["/api/v2/users"]["get"]["operationId"] == (
        "get_api_v2_users_list_users"
    )


def test_operation_ids_are_lowercase_alphanumeric_or_underscore() -> None:
    app = FastAPI()

    def Read_Items() -> dict[str, bool]:  # noqa: N802
        return {"ok": True}

    app.add_api_route("/API/{item_id}/details+", Read_Items, methods=["POST"])

    openapi = TestClient(app).get("/openapi.json").json()

    operation_id = openapi["paths"]["/API/{item_id}/details+"]["post"]["operationId"]
    assert operation_id == "post_api_item_id_details_read_items"
    assert operation_id.lower() == operation_id
    assert all(char.isalnum() or char == "_" for char in operation_id)


def test_multi_method_routes_get_method_specific_operation_ids() -> None:
    app = FastAPI()

    def handle_items() -> dict[str, bool]:
        return {"ok": True}

    app.add_api_route("/items", handle_items, methods=["GET", "POST"])

    openapi = TestClient(app).get("/openapi.json").json()

    assert openapi["paths"]["/items"]["get"]["operationId"] == (
        "get_items_handle_items"
    )
    assert openapi["paths"]["/items"]["post"]["operationId"] == (
        "post_items_handle_items"
    )


def test_generated_operation_id_collisions_get_numeric_suffix() -> None:
    app = FastAPI()

    def read_item() -> dict[str, bool]:
        return {"ok": True}

    app.add_api_route("/items/a-b", read_item, methods=["GET"])
    app.add_api_route("/items/a_b", read_item, methods=["GET"])

    with warnings.catch_warnings(record=True) as recorded_warnings:
        openapi = TestClient(app).get("/openapi.json").json()

    assert openapi["paths"]["/items/a-b"]["get"]["operationId"] == (
        "get_items_a_b_read_item"
    )
    assert openapi["paths"]["/items/a_b"]["get"]["operationId"] == (
        "get_items_a_b_read_item_2"
    )
    assert not [
        warning
        for warning in recorded_warnings
        if "Duplicate Operation ID" in str(warning.message)
    ]


def test_explicit_duplicate_operation_ids_keep_warning() -> None:
    app = FastAPI()

    def first() -> dict[str, bool]:
        return {"ok": True}

    def second() -> dict[str, bool]:
        return {"ok": True}

    app.add_api_route("/first", first, methods=["GET"], operation_id="duplicate")
    app.add_api_route("/second", second, methods=["GET"], operation_id="duplicate")

    client = TestClient(app)
    with pytest.warns(UserWarning, match="Duplicate Operation ID duplicate"):
        response = client.get("/openapi.json")

    assert response.json()["paths"]["/second"]["get"]["operationId"] == "duplicate"
