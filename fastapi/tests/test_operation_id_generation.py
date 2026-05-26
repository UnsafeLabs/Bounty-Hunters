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


def test_generated_operation_ids_are_lowercase_alphanumeric_underscore() -> None:
    app = FastAPI()

    def Read_Items() -> dict[str, bool]:  # noqa: N802
        return {"ok": True}

    app.add_api_route("/API/{item-id}", Read_Items, methods=["POST"])

    openapi = TestClient(app).get("/openapi.json").json()

    assert openapi["paths"]["/API/{item-id}"]["post"]["operationId"] == (
        "post_api_item_id_read_items"
    )


def test_generated_operation_id_collisions_get_numeric_suffix() -> None:
    app = FastAPI()

    def read_item() -> dict[str, bool]:
        return {"ok": True}

    app.add_api_route("/items/a-b", read_item, methods=["GET"])
    app.add_api_route("/items/a_b", read_item, methods=["GET"])

    with pytest.warns(UserWarning, match="Duplicate Operation ID"):
        openapi = TestClient(app).get("/openapi.json").json()

    assert openapi["paths"]["/items/a-b"]["get"]["operationId"] == (
        "get_items_a_b_read_item"
    )
    assert openapi["paths"]["/items/a_b"]["get"]["operationId"] == (
        "get_items_a_b_read_item_2"
    )
