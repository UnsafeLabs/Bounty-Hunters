"""
Unit tests for `generate_unique_id` function.
Verifies uniqueness across routers, format, sanitization, and collision resolution.
"""

import logging
import re
from typing import Any, Callable, Optional, Set

import pytest
from fastapi.routing import APIRoute
from fastapi.utils import generate_unique_id, _generated_ids

logger = logging.getLogger(__name__)


def _dummy_endpoint() -> None:
    """A simple dummy endpoint for route creation."""
    pass


def _make_mock_route(
    *,
    methods: Optional[Set[str]] = None,
    path: str = "/test",
    endpoint: Optional[Callable[..., Any]] = None,
    prefix: str = "",
) -> APIRoute:
    """
    Create a minimal APIRoute with the given attributes for testing.

    Args:
        methods: Set of HTTP methods (e.g., {"GET", "POST"}).
        path: URL path for the route.
        endpoint: Callable endpoint function. If not provided, uses a dummy.
        prefix: Router prefix (simulated via custom attribute).

    Returns:
        APIRoute instance configured with provided parameters.
    """
    if methods is None:
        methods = {"GET"}
    if endpoint is None:
        endpoint = _dummy_endpoint

    route = APIRoute(
        path=path,
        endpoint=endpoint,
        methods=methods,
        include_in_schema=True,
    )
    route.prefix = prefix  # type: ignore[attr-defined]
    return route


def collision_endpoint() -> None:
    """Dummy endpoint with a name that may cause collisions."""
    pass


def _sanitize_id(operation_id: str) -> str:
    """
    Apply same sanitization as the real function for validation in tests.
    Ensures only lowercase alphanumeric and underscores.
    """
    return re.sub(r"[^a-z0-9_]", "_", operation_id.lower())


class TestGenerateUniqueId:
    """
    Test suite for `generate_unique_id` covering format, uniqueness,
    sanitization, and collision resolution.
    """

    @pytest.fixture(autouse=True)
    def reset_generated_ids(self) -> None:
        """Reset the global set of generated IDs before each test to ensure isolation."""
        _generated_ids.clear()

    @pytest.fixture(autouse=True)
    def setup_logging(self, caplog: pytest.LogCaptureFixture) -> None:
        """Enable debug logging for all tests in this class."""
        caplog.set_level(logging.DEBUG, logger="tests")

    # ------------------------------------------------------------------
    # Exact format tests
    # ------------------------------------------------------------------

    def test_format_with_method_and_prefix(self) -> None:
        """
        Verify that the generated ID follows the exact pattern:
        ``method_prefix_functionname`` with underscores separating parts.

        Example: GET /users with function list_users => get_users_list_users
        """
        def list_users() -> None:
            pass

        route = _make_mock_route(
            methods={"GET"},
            path="/",
            endpoint=list_users,
            prefix="/users",
        )
        op_id = generate_unique_id(route)
        expected = "get_users_list_users"
        assert op_id == expected, f"Expected '{expected}', got '{op_id}'"
        assert re.fullmatch(r"[a-z0-9_]+", op_id), f"ID '{op_id}' contains invalid characters"

    def test_format_no_prefix(self) -> None:
        """
        When no router prefix is set, the ID should still include the method
        and function name, separated by underscore.
        """
        def create_item() -> None:
            pass

        route = _make_mock_route(
            methods={"POST"},
            path="/items",
            endpoint=create_item,
            prefix="",
        )
        op_id = generate_unique_id(route)
        assert op_id == "post_create_item", f"Expected 'post_create_item', got '{op_id}'"
        assert re.fullmatch(r"[a-z0-9_]+", op_id), f"ID '{op_id}' contains invalid characters"

    def test_format_with_nested_prefix(self) -> None:
        """
        Prefixes with multiple segments should be flattened with underscores.
        For example, prefix='/api/v1' with function get_users => 'get_api_v1_get_users'.
        """
        def get_users() -> None:
            pass

        route = _make_mock_route(
            methods={"GET"},
            path="/users",
            endpoint=get_users,
            prefix="/api/v1",
        )
        op_id = generate_unique_id(route)
        expected = "get_api_v1_get_users"
        assert op_id == expected, f"Expected '{expected}', got '{op_id}'"
        assert re.fullmatch(r"[a-z0-9_]+", op_id)

    # ------------------------------------------------------------------
    # Sanitization tests
    # ------------------------------------------------------------------

    def test_sanitization_lowercase_alphanumeric_underscore(self) -> None:
        """
        The generated ID must contain only lowercase alphanumeric characters
        and underscores. Special characters, spaces, uppercase letters, etc.
        must be replaced or removed.
        """
        def MySpecialEndpoint_123() -> None:
            pass

        route = _make_mock_route(
            methods={"GET"},
            path="/special",
            endpoint=MySpecialEndpoint_123,
            prefix="/UPPER-CASE/",
        )
        op_id = generate_unique_id(route)
        # Sanitization should lowercase everything, replace hyphens,
        # and keep underscores and alphanumeric.
        expected = "get_upper_case_myspecialendpoint_123"
        assert op_id == expected, f"Expected '{expected}', got '{op_id}'"
        assert re.fullmatch(r"[a-z0-9_]+", op_id)

    def test_sanitization_special_characters(self) -> None:
        """
        Endpoint or prefix with characters like '.', '@', '#' should be
        replaced with underscores or removed.
        """
        def my_func() -> None:
            pass

        route = _make_mock_route(
            methods={"GET"},
            path="/data",
            endpoint=my_func,
            prefix="/my.prefix@v1#x",
        )
        op_id = generate_unique_id(route)
        # All non-alphanumeric/underscore become underscores; multiple underscores collapse?
        # The implementation should replace each with underscore.
        # We only check that the ID is valid and contains recognizable parts.
        assert op_id.startswith("get_")
        assert "my" in op_id
        assert "prefix" in op_id
        assert "v1" in op_id
        assert "x" in op_id
        assert re.fullmatch(r"[a-z0-9_]+", op_id)

    # ------------------------------------------------------------------
    # Uniqueness tests
    # ------------------------------------------------------------------

    def test_uniqueness_across_routers_same_function_name(self) -> None:
        """
        Two routes from different routers with the same function name
        must produce different operation IDs because the prefix differs.
        """
        def same_func() -> None:
            pass

        route_a = _make_mock_route(
            methods={"GET"},
            path="/items",
            endpoint=same_func,
            prefix="/api/v1",
        )
        route_b = _make_mock_route(
            methods={"GET"},
            path="/items",
            endpoint=same_func,
            prefix="/api/v2",
        )
        id_a = generate_unique_id(route_a)
        id_b = generate_unique_id(route_b)
        assert id_a != id_b, "IDs should differ due to different prefixes"
        assert id_a == "get_api_v1_same_func"
        assert id_b == "get_api_v2_same_func"
        assert re.fullmatch(r"[a-z0-9_]+", id_a)
        assert re.fullmatch(r"[a-z0-9_]+", id_b)

    def test_uniqueness_same_prefix_same_function_different_methods(self) -> None:
        """
        Even with the same prefix and function, different HTTP methods
        should produce different IDs (method is part of the ID).
        """
        def handle() -> None:
            pass

        route_get = _make_mock_route(
            methods={"GET"},
            path="/resource",
            endpoint=handle,
            prefix="/api",
        )
        route_post = _make_mock_route(
            methods={"POST"},
            path="/resource",
            endpoint=handle,
            prefix="/api",
        )
        id_get = generate_unique_id(route_get)
        id_post = generate_unique_id(route_post)
        assert id_get != id_post, "Different methods should yield different IDs"
        assert id_get == "get_api_handle"
        assert id_post == "post_api_handle"
        assert re.fullmatch(r"[a-z0-9_]+", id_get)
        assert re.fullmatch(r"[a-z0-9_]+", id_post)

    def test_uniqueness_different_endpoints_same_base(self) -> None:
        """
        Two different route instances with identical method, prefix, and
        function name (but different function objects) should not collide
        because the function __name__ is the same. This tests the collision
        detection when the base ID is already in the set from a previous route.
        """
        def process() -> None:
            """Endpoint placeholder."""
            pass

        route1 = _make_mock_route(
            methods={"POST"},
            path="/first",
            endpoint=process,
            prefix="/data",
        )
        route2 = _make_mock_route(
            methods={"POST"},
            path="/second",
            endpoint=process,
            prefix="/data",
        )
        id1 = generate_unique_id(route1)
        id2 = generate_unique_id(route2)
        assert id1 == "post_data_process", f"Expected base ID, got '{id1}'"
        assert id2 == "post_data_process_1", f"Expected collision suffix, got '{id2}'"
        assert re.fullmatch(r"[a-z0-9_]+", id1)
        assert re.fullmatch(r"[a-z0-9_]+", id2)

    # ------------------------------------------------------------------
    # Collision resolution tests
    # ------------------------------------------------------------------

    def test_collision_resolution_numeric_suffix(self) -> None:
        """
        When the method+prefix+function combination would collide,
        a numeric suffix must be appended to the second occurrence.
        Uses function `collision_endpoint` (no leading underscore).
        """
        endpoint1 = collision_endpoint
        endpoint2 = collision_endpoint

        route1 = _make_mock_route(
            methods={"POST"},
            path="/first",
            endpoint=endpoint1,
            prefix="/same",
        )
        route2 = _make_mock_route(
            methods={"POST"},
            path="/second",
            endpoint=endpoint2,
            prefix="/same",
        )
        id1 = generate_unique_id(route1)
        id2 = generate_unique_id(route2)
        assert id1 != id2, "Collision must be resolved with a suffix"
        expected_base = "post_same_collision_endpoint"
        assert id1 == expected_base, f"Expected base ID, got '{id1}'"
        assert id2 == expected_base + "_1", f"Expected '{expected_base}_1', got '{id2}'"
        assert re.fullmatch(r"[a-z0-9_]+", id1)
        assert re.fullmatch(r"[a-z0-9_]+", id2)

    def test_collision_escalation_three_way(self) -> None:
        """
        When three routes share the same method, prefix, and function name,
        the second should get suffix '_1', the third '_2'.
        """
        def common_func() -> None:
            pass

        route1 = _make_mock_route(
            methods={"GET"},
            path="/a",
            endpoint=common_func,
            prefix="/app",
        )
        route2 = _make_mock_route(
            methods={"GET"},
            path="/b",
            endpoint=common_func,
            prefix="/app",
        )
        route3 = _make_mock_route(
            methods={"GET"},
            path="/c",
            endpoint=common_func,
            prefix="/app",
        )
        id1 = generate_unique_id(route1)
        id2 = generate_unique_id(route2)
        id3 = generate_unique_id(route3)
        assert id1 == "get_app_common_func"
        assert id2 == "get_app_common_func_1"
        assert id3 == "get_app_common_func_2"

    def test_collision_with_empty_prefix(self) -> None:
        """
        Two routes with empty prefix, same method, same function name
        should still cause collision and get numeric suffix.
        """
        def action() -> None:
            pass

        route1 = _make_mock_route(
            methods={"DELETE"},
            path="/res1",
            endpoint=action,
            prefix="",
        )
        route2 = _make_mock_route(
            methods={"DELETE"},
            path="/res2",
            endpoint=action,
            prefix="",
        )
        id1 = generate_unique_id(route1)
        id2 = generate_unique_id(route2)
        assert id1 == "delete_action"
        assert id2 == "delete_action_1"

    def test_same_route_called_twice_returns_same_id(self) -> None:
        """
        Calling `generate_unique_id` twice with the same route instance
        should return the same operation ID because the route's __name__
        and prefix are identical, and the ID is already registered.
        """
        def handler() -> None:
            pass

        route = _make_mock_route(
            methods={"PUT"},
            path="/item",
            endpoint=handler,
            prefix="/store",
        )
        first = generate_unique_id(route)
        second = generate_unique_id(route)
        assert first == second, "Same route should produce same ID"
        assert first == "put_store_handler"
        assert second == "put_store_handler"

    def test_method_case_normalization(self) -> None:
        """
        HTTP methods are given as strings in uppercase; the generated ID
        should use lowercase version.
        """
        def operate() -> None:
            pass

        route = _make_mock_route(
            methods={"GET", "POST"},
            path="/multi",
            endpoint=operate,
            prefix="/api",
        )
        # For multiple methods, the implementation chooses the first method
        # alphabetically or in order; we just check it's lowercase.
        op_id = generate_unique_id(route)
        assert op_id.startswith("get_") or op_id.startswith("post_")
        assert re.fullmatch(r"[a-z0-9_]+", op_id)

    # ------------------------------------------------------------------
    # Edge cases
    # ------------------------------------------------------------------

    def test_empty_endpoint_name(self) -> None:
        """
        If the endpoint is a lambda or lacks __name__, the implementation
        should fallback gracefully (e.g., use 'unknown' or 'lambda').
        We test that no exception occurs and ID is valid.
        """
        route = _make_mock_route(
            methods={"GET"},
            path="/anon",
            endpoint=(lambda: None),  # __name__ is '<lambda>'
            prefix="/test",
        )
        op_id = generate_unique_id(route)
        assert re.fullmatch(r"[a-z0-9_]+", op_id), f"ID '{op_id}' contains invalid characters"
        assert "<" not in op_id, f"ID '{op_id}' contains invalid characters"

    def test_prefix_with_extra_slashes(self) -> None:
        """
        Prefix with trailing slash or double slashes should be normalized.
        """
        def norm() -> None:
            pass

        route = _make_mock_route(
            methods={"GET"},
            path="/",
            endpoint=norm,
            prefix="//users//",
        )
        op_id = generate_unique_id(route)
        expected = "get_users_norm"
        assert op_id == expected, f"Expected '{expected}', got '{op_id}'"

    def test_no_method_annotation(self) -> None:
        """
        If route.methods is None or empty, the implementation should
        handle it gracefully (e.g., default to 'unknown').
        """
        route = _make_mock_route(
            methods=set(),  # empty set
            path="/void",
            endpoint=_dummy_endpoint,
            prefix="/api",
        )
        op_id = generate_unique_id(route)
        assert re.fullmatch(r"[a-z0-9_]+", op_id)
        # Should contain method indicator
        assert "get" in op_id or "post" in op_id or "unknown" in op_id