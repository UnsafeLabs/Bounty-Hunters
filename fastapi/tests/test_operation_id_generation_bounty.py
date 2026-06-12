import pytest
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient


def test_default_operation_ids_include_method_prefix_and_endpoint_name():
    app = FastAPI()
    users_router = APIRouter(prefix="/users")
    teams_router = APIRouter(prefix="/teams")

    def users_list_items():
        return []

    def teams_list_items():
        return []

    users_list_items.__name__ = "list_items"
    teams_list_items.__name__ = "list_items"
    users_router.add_api_route("/", users_list_items, methods=["GET"])
    teams_router.add_api_route("/", teams_list_items, methods=["GET"])

    app.include_router(users_router)
    app.include_router(teams_router)

    schema = TestClient(app).get("/openapi.json").json()

    assert schema["paths"]["/users/"]["get"]["operationId"] == "get_users_list_items"
    assert schema["paths"]["/teams/"]["get"]["operationId"] == "get_teams_list_items"


def test_default_operation_ids_are_lowercase_alphanumeric_and_underscores():
    app = FastAPI()

    @app.post("/API-v1/items/")
    def create_item():
        return {}

    schema = TestClient(app).get("/openapi.json").json()

    assert (
        schema["paths"]["/API-v1/items/"]["post"]["operationId"]
        == "post_api_v1_items_create_item"
    )


def test_duplicate_operation_ids_get_numeric_suffixes():
    app = FastAPI()

    @app.get("/first", operation_id="duplicate")
    def first():
        return {}

    @app.get("/second", operation_id="duplicate")
    def second():
        return {}

    with pytest.warns(UserWarning, match="Duplicate Operation ID duplicate"):
        schema = TestClient(app).get("/openapi.json").json()

    assert schema["paths"]["/first"]["get"]["operationId"] == "duplicate"
    assert schema["paths"]["/second"]["get"]["operationId"] == "duplicate_2"
