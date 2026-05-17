import pytest
from fastapi import FastAPI, APIRouter
from fastapi.testclient import TestClient


def test_generate_unique_id_includes_method_and_prefix():
    """Verify that operation IDs contain HTTP method and router prefix."""
    router1 = APIRouter(prefix="/api/v1")
    router2 = APIRouter(prefix="/api/v2")

    @router1.get("/items")
    def list_items_v1():
        return {"v": 1}

    @router2.get("/items")
    def list_items_v2():
        return {"v": 2}

    app = FastAPI()
    app.include_router(router1)
    app.include_router(router2)

    openapi = app.openapi()
    paths = openapi["paths"]
    # The operation IDs should be unique and contain method and prefix
    ops = []
    for path, methods in paths.items():
        for method, detail in methods.items():
            ops.append(detail["operationId"])

    # We expect something like "get_api_v1_list_items_v1" and "get_api_v2_list_items_v2"
    # (function name includes the trailing '_v1' due to we named functions differently)
    # Actually function names are list_items_v1 and list_items_v2, so they already differ.
    # To truly test collision prevention, use same function name.
    assert len(ops) == 2
    # Check format: method_prefix_functionname
    for op_id in ops:
        parts = op_id.split("_")
        assert parts[0] in ("get", "post", "put", "delete", "patch")
        assert "api" in parts  # prefix appears
        assert "list" in parts


def test_no_duplicate_operation_ids_with_same_function_name():
    """When routers have the same function name but different prefixes, IDs must differ."""
    router_a = APIRouter(prefix="/a")
    router_b = APIRouter(prefix="/b")

    def same_function():
        return {"ok": True}

    router_a.add_api_route("/endpoint", same_function, methods=["GET"])
    router_b.add_api_route("/endpoint", same_function, methods=["GET"])

    app = FastAPI()
    app.include_router(router_a)
    app.include_router(router_b)

    openapi = app.openapi()
    ops = []
    for path, methods in openapi["paths"].items():
        for method, detail in methods.items():
            ops.append(detail["operationId"])

    assert len(ops) == len(set(ops)), f"Duplicate operation IDs found: {ops}"
    # IDs should be "get_a_same_function" and "get_b_same_function"
    for op_id in ops:
        assert "_" in op_id
        assert op_id.islower()
        # Should contain only a-z, 0-9, underscore
        assert all(c.isalnum() or c == "_" for c in op_id)


def test_numeric_suffix_on_collision():
    """When method+prefix+name still collides, a numeric suffix is appended."""
    # Create two routers with same prefix and same function name?
    # That would normally be impossible, but we can force a collision by using
    # the same route object? Actually we need two routes that produce identical base.
    # We can manually add two routes with identical method, prefix, and name.
    router = APIRouter(prefix="/test")

    # Add two routes using the same function name but different paths?
    # That would give different path, but we only care about the operation id generation.
    # To trigger collision, we need to add the same function twice.
    # That's not allowed in FastAPI normally (app startup will fail with duplicate path).
    # So we'll test the generate_unique_id function directly instead.
    from fastapi.routing import APIRoute
    from fastapi.utils import generate_unique_id

    # Reset internal counter
    if hasattr(generate_unique_id, "_used"):
        generate_unique_id._used.clear()

    # Create two mock routes (we need minimal attributes)
    class MockRoute:
        methods = {"GET"}
        name = "test_func"
        prefix = "/api"

    route1 = MockRoute()
    route2 = MockRoute()

    id1 = generate_unique_id(route1)
    id2 = generate_unique_id(route2)

    assert id1 == "get_api_test_func"
    assert id2 == "get_api_test_func_1"  # numeric suffix appended


def test_sanitization_lowercase_and_underscore():
    """IDs must contain only lowercase alphanumeric and underscores."""
    from fastapi.routing import APIRoute
    from fastapi.utils import generate_unique_id

    if hasattr(generate_unique_id, "_used"):
        generate_unique_id._used.clear()

    class MockRoute:
        methods = {"GET"}
        name = "FooBar!"
        prefix = "/my-Prefix/"

    route = MockRoute()
    op_id = generate_unique_id(route)
    # Expected: method=GET -> get, prefix=my-Prefix -> my_prefix, name=FooBar! -> foobar
    # Combined: get_my_prefix_foobar!
    # After sanitization: get_my_prefix_foobar_
    assert op_id == "get_my_prefix_foobar_"
    assert all(c.isalnum() or c == "_" for c in op_id)
    assert op_id.islower()


def test_no_prefix_generates_consistent_format():
    """Routes without a prefix produce IDs with method_functionname."""
    from fastapi.routing import APIRoute
    from fastapi.utils import generate_unique_id

    if hasattr(generate_unique_id, "_used"):
        generate_unique_id._used.clear()

    class MockRoute:
        methods = {"POST"}
        name = "create_item"
        prefix = ""

    route = MockRoute()
    op_id = generate_unique_id(route)
    assert op_id == "post_create_item"
