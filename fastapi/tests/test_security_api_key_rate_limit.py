import time

from fastapi import Depends, FastAPI
from fastapi.responses import JSONResponse
from fastapi.security import APIKeyWithRateLimit
from fastapi.testclient import TestClient

app = FastAPI()

# Rate limit: 5 requests per 2 seconds (short window for fast testing)
security = APIKeyWithRateLimit(
    name="x-api-key",
    rate_limit="5/2second",
    deprecated_keys=["old-key-deprecated"],
)


@app.get("/items/")
async def read_items(key: str = Depends(security)):
    return {"key": key}


client = TestClient(app)


# --- Rate limiting tests ---

def test_rate_limit_allows_requests_within_limit():
    """Up to 5 requests in the 2-second window should succeed."""
    for _ in range(5):
        response = client.get("/items/", headers={"x-api-key": "valid-key-1"})
        assert response.status_code == 200, response.text
        assert response.json() == {"key": "valid-key-1"}


def test_rate_limit_blocks_after_limit():
    """The 6th request in the window should get 429."""
    # Use a dedicated key so previous tests don't affect this one
    for _ in range(5):
        client.get("/items/", headers={"x-api-key": "burst-key"})
    response = client.get("/items/", headers={"x-api-key": "burst-key"})
    assert response.status_code == 429, response.text
    assert response.json() == {"detail": "Rate limit exceeded"}
    # Retry-After header should be present and be a positive integer
    retry_after = response.headers.get("Retry-After")
    assert retry_after is not None, "Missing Retry-After header"
    assert int(retry_after) > 0, f"Retry-After should be positive, got {retry_after}"


def test_rate_limit_resets_after_window():
    """After the window expires, requests should succeed again."""
    key = "window-reset-key"
    # Exhaust the limit
    for _ in range(5):
        client.get("/items/", headers={"x-api-key": key})
    # Verify blocked
    response = client.get("/items/", headers={"x-api-key": key})
    assert response.status_code == 429
    # Wait for window to expire (2 seconds + buffer)
    time.sleep(2.5)
    # Should succeed now
    response = client.get("/items/", headers={"x-api-key": key})
    assert response.status_code == 200, response.text


def test_rate_limit_tracks_keys_independently():
    """Each API key has its own counter."""
    for _ in range(5):
        client.get("/items/", headers={"x-api-key": "key-a"})
        client.get("/items/", headers={"x-api-key": "key-b"})
    # The 6th for key-a should fail
    response_a = client.get("/items/", headers={"x-api-key": "key-a"})
    assert response_a.status_code == 429
    # key-b should also be at its limit
    response_b = client.get("/items/", headers={"x-api-key": "key-b"})
    assert response_b.status_code == 429
    # A different key should still work
    response_c = client.get("/items/", headers={"x-api-key": "key-c"})
    assert response_c.status_code == 200, response_c.text


# --- Deprecated key tests ---

def test_deprecated_key_authenticates_successfully():
    """A deprecated key should still work (200 OK)."""
    response = client.get("/items/", headers={"x-api-key": "old-key-deprecated"})
    assert response.status_code == 200, response.text
    assert response.json() == {"key": "old-key-deprecated"}
    # Verify Warning header is present
    assert "warning" in str(response.headers).lower(), (
        f"Expected Warning header in response, got headers: {dict(response.headers)}"
    )


def test_non_deprecated_key_has_no_warning():
    """A non-deprecated key should NOT include a Warning header."""
    response = client.get("/items/", headers={"x-api-key": "fresh-key"})
    assert response.status_code == 200, response.text
    warning = response.headers.get("warning", response.headers.get("Warning"))
    assert warning is None, f"Non-deprecated key should not have Warning header, got: {warning}"


# --- Auth failure tests ---

def test_missing_key_returns_401():
    """Request without API key should return 401."""
    response = client.get("/items/")
    assert response.status_code == 401, response.text
    assert response.json() == {"detail": "Not authenticated"}
    assert response.headers.get("WWW-Authenticate") == "APIKey"
