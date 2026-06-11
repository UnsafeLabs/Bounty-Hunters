import re
import warnings

from fastapi import APIRouter, FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient


def list_users() -> dict[str, bool]:
    return {"ok": True}


def read() -> dict[str, bool]:
    return {"ok": True}


def operation_ids(app: FastAPI) -> list[str]:
    schema = TestClient(app).get("/openapi.json").json()
    ids: list[str] = []
    for path_item in schema["paths"].values():
        for operation in path_item.values():
            ids.append(operation["operationId"])
    return ids


def test_generate_unique_id_includes_method_and_router_prefix() -> None:
    app = FastAPI()
    first_router = APIRouter()
    second_router = APIRouter()

    first_router.get("/users")(list_users)
    second_router.get("/users")(list_users)
    app.include_router(first_router, prefix="/api/v1")
    app.include_router(second_router, prefix="/api/v2")

    ids = operation_ids(app)

    assert "get_api_v1_users_list_users" in ids
    assert "get_api_v2_users_list_users" in ids
    assert len(ids) == len(set(ids))


def test_generate_unique_id_is_lowercase_alphanumeric_with_underscores() -> None:
    app = FastAPI()
    app.get("/Items/{item_id}/sub-items")(read)

    [operation_id] = operation_ids(app)

    assert re.fullmatch(r"[a-z0-9_]+", operation_id)
    assert operation_id == "get_items_item_id_sub_items_read"


def test_openapi_generation_suffixes_generated_collisions_without_warning() -> None:
    app = FastAPI()
    app.get("/items/a-b")(read)
    app.get("/items/a_b")(read)

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        ids = operation_ids(app)

    duplicate_warnings = [
        warning
        for warning in caught
        if "Duplicate Operation ID" in str(warning.message)
    ]
    assert duplicate_warnings == []
    assert ids == ["get_items_a_b_read", "get_items_a_b_read_2"]


def test_custom_unique_id_collisions_warn_and_receive_suffixes() -> None:
    def duplicate_unique_id(route: APIRoute) -> str:
        return "same_id"

    app = FastAPI(generate_unique_id_function=duplicate_unique_id)
    app.get("/first")(read)
    app.get("/second")(read)

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        ids = operation_ids(app)

    duplicate_warnings = [
        warning
        for warning in caught
        if "Duplicate Operation ID" in str(warning.message)
    ]
    assert duplicate_warnings
    assert ids == ["same_id", "same_id_2"]
