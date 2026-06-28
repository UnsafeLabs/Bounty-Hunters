import re

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.routing import APIRoute
from fastapi.utils import generate_unique_id


def test_generate_unique_id_includes_method_path_and_name():
    app = FastAPI()

    @app.get("/Team/user-ID")
    def Read_User():
        return {"ok": True}

    route = next(route for route in app.routes if isinstance(route, APIRoute))

    operation_id = generate_unique_id(route)

    assert operation_id == "get_team_user_id_read_user"
    assert re.fullmatch(r"[a-z0-9_]+", operation_id)


def test_operation_ids_are_unique_across_router_prefixes():
    app = FastAPI()
    users = APIRouter(prefix="/api/v1/users")
    admins = APIRouter(prefix="/api/v1/admins")

    @users.get("/", name="list_records")
    def list_user_records():
        return []

    @admins.get("/", name="list_records")
    def list_admin_records():
        return []

    app.include_router(users)
    app.include_router(admins)

    schema = app.openapi()

    assert (
        schema["paths"]["/api/v1/users/"]["get"]["operationId"]
        == "get_api_v1_users_list_records"
    )
    assert (
        schema["paths"]["/api/v1/admins/"]["get"]["operationId"]
        == "get_api_v1_admins_list_records"
    )


def test_operation_id_suffix_added_for_sanitized_collisions():
    app = FastAPI()

    @app.get("/items/foo-bar", name="read_item")
    def read_hyphen_item():
        return {"item": "hyphen"}

    @app.get("/items/foo_bar", name="read_item")
    def read_underscore_item():
        return {"item": "underscore"}

    with pytest.warns(UserWarning, match="Duplicate Operation ID"):
        schema = app.openapi()

    assert (
        schema["paths"]["/items/foo-bar"]["get"]["operationId"]
        == "get_items_foo_bar_read_item"
    )
    assert (
        schema["paths"]["/items/foo_bar"]["get"]["operationId"]
        == "get_items_foo_bar_read_item_2"
    )
