"""Test request-scoped dependency caching.

This tests that dependencies with scope="request" are always cached
within a single request, regardless of the use_cache flag.
"""
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

call_count = {"dep_request_scoped": 0, "dep_function_scoped": 0}


def dep_request_scoped():
    """A dependency with scope='request' that should be cached per request."""
    call_count["dep_request_scoped"] += 1
    return "request_scoped_value"


def dep_function_scoped():
    """A dependency with scope='function' that is NOT cached."""
    call_count["dep_function_scoped"] += 1
    return "function_scoped_value"


app = FastAPI()


@app.get("/items")
async def read_items(
    req_val: str = Depends(dep_request_scoped, scope="request", use_cache=False),
    func_val: str = Depends(dep_function_scoped),
):
    return {"req": req_val, "func": func_val}


client = TestClient(app)


def test_request_scoped_dep_is_cached():
    """Test that scope='request' dependencies are cached even with use_cache=False."""
    # Reset call counts
    call_count["dep_request_scoped"] = 0
    call_count["dep_function_scoped"] = 0

    response = client.get("/items")
    assert response.status_code == 200, response.text
    assert response.json() == {"req": "request_scoped_value", "func": "function_scoped_value"}

    # The request-scoped dependency should have been called once
    assert call_count["dep_request_scoped"] == 1, (
        f"Expected request-scoped dep called 1, got {call_count['dep_request_scoped']}"
    )
    # The function-scoped dependency should have been called once
    assert call_count["dep_function_scoped"] == 1, (
        f"Expected function-scoped dep called 1, got {call_count['dep_function_scoped']}"
    )

    # Second request - counts should increase (caching is per-request, not global)
    call_count["dep_request_scoped"] = 0
    call_count["dep_function_scoped"] = 0

    response = client.get("/items")
    assert response.status_code == 200, response.text

    # Both should be called once per request
    assert call_count["dep_request_scoped"] == 1, (
        f"Expected request-scoped dep called 1, got {call_count['dep_request_scoped']}"
    )
    assert call_count["dep_function_scoped"] == 1, (
        f"Expected function-scoped dep called 1, got {call_count['dep_function_scoped']}"
    )


def test_request_scoped_dep_cache_shared():
    """Test that a request-scoped dependency is shared across dependents within a request."""
    call_count["dep_request_scoped"] = 0
    call_count["dep_function_scoped"] = 0

    local_call_count = {"shared_dep": 0}

    def shared_dep():
        local_call_count["shared_dep"] += 1
        return "shared_value"

    def consumer_a(val: str = Depends(shared_dep, scope="request", use_cache=False)):
        return {"dep": val}

    def consumer_b(val: str = Depends(shared_dep, scope="request", use_cache=False)):
        return {"dep": val}

    local_app = FastAPI()

    @local_app.get("/multi")
    async def multi_endpoint(
        a: dict = Depends(consumer_a),
        b: dict = Depends(consumer_b),
    ):
        return {"a": a, "b": b}

    local_client = TestClient(local_app)

    response = local_client.get("/multi")
    assert response.status_code == 200, response.text
    assert response.json() == {
        "a": {"dep": "shared_value"},
        "b": {"dep": "shared_value"},
    }

    # The shared dependency should only be called once per request
    # even though it's consumed by two dependents with use_cache=False
    assert local_call_count["shared_dep"] == 1, (
        f"Expected shared dep called 1, got {local_call_count['shared_dep']}"
    )

    # Second request - should be called again
    response = local_client.get("/multi")
    assert response.status_code == 200
    assert local_call_count["shared_dep"] == 2, (
        f"Expected shared dep called 2, got {local_call_count['shared_dep']}"
    )
