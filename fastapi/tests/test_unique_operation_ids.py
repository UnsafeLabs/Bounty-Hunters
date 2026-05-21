import re
import warnings

from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient


def test_default_operation_ids_include_method_prefix_and_route_path():
    app = FastAPI()
    users_router = APIRouter(prefix="/users")
    admin_router = APIRouter(prefix="/admin/users")

    def make_list_users_endpoint():
        def list_users():
            return []  # pragma: nocover

        return list_users

    users_router.get("/")(make_list_users_endpoint())
    admin_router.get("/")(make_list_users_endpoint())

    app.include_router(users_router)
    app.include_router(admin_router)

    schema = TestClient(app).get("/openapi.json").json()

    user_operation_id = schema["paths"]["/users/"]["get"]["operationId"]
    admin_operation_id = schema["paths"]["/admin/users/"]["get"]["operationId"]

    assert user_operation_id == "get_users_list_users"
    assert admin_operation_id == "get_admin_users_list_users"
    assert user_operation_id != admin_operation_id
    assert re.fullmatch(r"[a-z0-9_]+", user_operation_id)
    assert re.fullmatch(r"[a-z0-9_]+", admin_operation_id)


def test_duplicate_operation_ids_receive_numeric_suffix():
    app = FastAPI()

    def read_item():
        return {"ok": True}  # pragma: nocover

    app.get("/items/foo-bar")(read_item)
    app.get("/items/foo_bar")(read_item)

    with warnings.catch_warnings(record=True) as recorded_warnings:
        warnings.simplefilter("always")
        schema = TestClient(app).get("/openapi.json").json()

    first_operation_id = schema["paths"]["/items/foo-bar"]["get"]["operationId"]
    second_operation_id = schema["paths"]["/items/foo_bar"]["get"]["operationId"]

    assert first_operation_id == "get_items_foo_bar_read_item"
    assert second_operation_id == "get_items_foo_bar_read_item_2"
    assert any(
        "Duplicate Operation ID get_items_foo_bar_read_item" in str(warning.message)
        for warning in recorded_warnings
    )
