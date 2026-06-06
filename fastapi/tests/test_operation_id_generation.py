import pytest
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient


def test_operation_ids_include_method_path_and_function_name():
    app = FastAPI()
    users_router = APIRouter(prefix="/users")
    admins_router = APIRouter(prefix="/admin/users")

    @users_router.get("/", name="list_users")
    def list_regular_users():
        return []

    @admins_router.get("/", name="list_users")
    def list_admin_users():
        return []

    app.include_router(users_router)
    app.include_router(admins_router)

    schema = TestClient(app).get("/openapi.json").json()

    assert schema["paths"]["/users/"]["get"]["operationId"] == "get_users_list_users"
    assert (
        schema["paths"]["/admin/users/"]["get"]["operationId"]
        == "get_admin_users_list_users"
    )


def test_operation_ids_are_lowercase_alphanumeric_and_underscores():
    app = FastAPI()

    @app.post("/API/v1/widgets/{Widget-ID}")
    def Create_Widget():
        return {}

    schema = TestClient(app).get("/openapi.json").json()

    assert (
        schema["paths"]["/API/v1/widgets/{Widget-ID}"]["post"]["operationId"]
        == "post_api_v1_widgets_widget_id_create_widget"
    )


def test_operation_id_collisions_receive_numeric_suffixes():
    app = FastAPI()

    @app.get("/items/a-b", name="read_item")
    def read_dash_item():
        return {}

    @app.get("/items/a_b", name="read_item")
    def read_underscore_item():
        return {}

    with pytest.warns(UserWarning, match="Duplicate Operation ID"):
        schema = TestClient(app).get("/openapi.json").json()

    assert (
        schema["paths"]["/items/a-b"]["get"]["operationId"] == "get_items_a_b_read_item"
    )
    assert (
        schema["paths"]["/items/a_b"]["get"]["operationId"]
        == "get_items_a_b_read_item_2"
    )


def test_operation_id_without_prefix_uses_consistent_method_name_format():
    app = FastAPI()

    @app.get("/")
    def read_root():
        return {}

    schema = TestClient(app).get("/openapi.json").json()

    assert schema["paths"]["/"]["get"]["operationId"] == "get_read_root"
