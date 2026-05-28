"""Tests for generate_unique_id producing unique IDs across routers."""
import re

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient
from fastapi.utils import generate_unique_id


class TestGenerateUniqueId:
    """Test that generate_unique_id produces unique, well-formatted IDs."""

    def test_basic_format(self):
        """Generated ID includes method and function name."""
        app = FastAPI()

        @app.get("/items")
        def list_items():
            return []

        routes = [r for r in app.routes if hasattr(r, "name") and r.name == "list_items"]
        assert len(routes) == 1
        uid = generate_unique_id(routes[0])
        assert "get" in uid
        assert uid == uid.lower()
        assert re.match(r"^[a-z0-9_]+$", uid)

    def test_different_routers_different_ids(self):
        """Same function name in different routers produces different IDs."""
        app = FastAPI()
        router1 = APIRouter(prefix="/api/v1")
        router2 = APIRouter(prefix="/api/v2")

        @router1.get("/items")
        def list_items():
            return []

        @router2.get("/items")
        def list_items():  # noqa: F811
            return []

        app.include_router(router1)
        app.include_router(router2)

        # Find the actual routes
        routes = [r for r in app.routes if hasattr(r, "methods") and r.methods]
        ids = [generate_unique_id(r) for r in routes]

        # All IDs should be unique
        assert len(ids) == len(set(ids)), f"Duplicate IDs found: {ids}"

    def test_ids_are_lowercase(self):
        """All generated IDs are lowercase."""
        app = FastAPI()

        @app.get("/Items")
        def ListItems():
            return []

        routes = [r for r in app.routes if hasattr(r, "name") and r.name == "ListItems"]
        uid = generate_unique_id(routes[0])
        assert uid == uid.lower()

    def test_ids_contain_only_allowed_chars(self):
        """IDs contain only lowercase alphanumeric and underscores."""
        app = FastAPI()

        @app.get("/items/{item_id}")
        def get_item(item_id: int):
            return {}

        routes = [r for r in app.routes if hasattr(r, "name") and r.name == "get_item"]
        uid = generate_unique_id(routes[0])
        assert re.match(r"^[a-z0-9_]+$", uid)

    def test_no_consecutive_underscores(self):
        """IDs don't have consecutive underscores."""
        app = FastAPI()

        @app.get("/items/{item_id}/details")
        def get_item_details(item_id: int):
            return {}

        routes = [r for r in app.routes if hasattr(r, "name") and r.name == "get_item_details"]
        uid = generate_unique_id(routes[0])
        assert "__" not in uid

    def test_no_leading_trailing_underscores(self):
        """IDs don't start or end with underscores."""
        app = FastAPI()

        @app.get("/items")
        def list_items():
            return []

        routes = [r for r in app.routes if hasattr(r, "name") and r.name == "list_items"]
        uid = generate_unique_id(routes[0])
        assert not uid.startswith("_")
        assert not uid.endswith("_")

    def test_method_included(self):
        """The HTTP method is included in the ID."""
        app = FastAPI()

        @app.get("/items")
        def list_items():
            return []

        @app.post("/items")
        def create_item():
            return {}

        get_routes = [r for r in app.routes if hasattr(r, "name") and r.name == "list_items"]
        post_routes = [r for r in app.routes if hasattr(r, "name") and r.name == "create_item"]
        get_id = generate_unique_id(get_routes[0])
        post_id = generate_unique_id(post_routes[0])

        assert get_id.endswith("_get")
        assert post_id.endswith("_post")
        assert get_id != post_id

    def test_path_with_parameters(self):
        """Paths with parameters produce valid IDs."""
        app = FastAPI()

        @app.get("/users/{user_id}/posts/{post_id}")
        def get_user_post(user_id: int, post_id: int):
            return {}

        routes = [r for r in app.routes if hasattr(r, "name") and r.name == "get_user_post"]
        uid = generate_unique_id(routes[0])
        assert re.match(r"^[a-z0-9_]+$", uid)
        assert "user_id" in uid
        assert "post_id" in uid

    def test_multiple_routers_with_same_function_name(self):
        """Comprehensive test: multiple routers with same endpoint names."""
        app = FastAPI()

        for prefix in ["/api/v1", "/api/v2", "/admin"]:
            router = APIRouter(prefix=prefix)

            @router.get("/users")
            def list_users():
                return []

            @router.post("/users")
            def create_user():
                return {}

            @router.get("/items")
            def list_items():
                return []

            app.include_router(router)

        routes = [r for r in app.routes if hasattr(r, "methods") and r.methods]
        ids = [generate_unique_id(r) for r in routes]

        # All IDs should be unique
        assert len(ids) == len(set(ids)), f"Duplicate IDs found: {ids}"

        # All IDs should be valid format
        for uid in ids:
            assert re.match(r"^[a-z0-9_]+$", uid), f"Invalid ID format: {uid}"


class TestOpenAPIWithUniqueIds:
    """Test that OpenAPI schema uses unique operation IDs."""

    def test_openapi_schema_no_duplicate_operation_ids(self):
        """OpenAPI schema has no duplicate operationIds."""
        app = FastAPI()

        router1 = APIRouter(prefix="/api/v1")
        router2 = APIRouter(prefix="/api/v2")

        @router1.get("/items")
        def list_items():
            return []

        @router2.get("/items")
        def list_items():  # noqa: F811
            return []

        app.include_router(router1)
        app.include_router(router2)

        client = TestClient(app)
        response = client.get("/openapi.json")
        assert response.status_code == 200

        schema = response.json()
        operation_ids = []
        for path, methods in schema.get("paths", {}).items():
            for method, details in methods.items():
                if "operationId" in details:
                    operation_ids.append(details["operationId"])

        assert len(operation_ids) == len(set(operation_ids)), (
            f"Duplicate operationIds in OpenAPI schema: {operation_ids}"
        )
