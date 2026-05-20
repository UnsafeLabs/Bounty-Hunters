import pytest
from fastapi import FastAPI, Depends, Response
from fastapi.security import APIKeyWithRateLimit
from fastapi.testclient import TestClient

app = FastAPI()

api_key_scheme = APIKeyWithRateLimit(
    name="x-api-key",
    rate_limit="2/minute",
    deprecated_keys=["old-key"]
)

@app.get("/items/")
async def read_items(key: str = Depends(api_key_scheme)):
    return {"key": key}

client = TestClient(app)

def test_rate_limit():
    # First request
    response = client.get("/items/", headers={"x-api-key": "test-key"})
    assert response.status_code == 200
    assert response.json() == {"key": "test-key"}
    assert "warning" not in response.headers

    # Second request (limit is 2)
    response = client.get("/items/", headers={"x-api-key": "test-key"})
    assert response.status_code == 200

    # Third request (should fail)
    response = client.get("/items/", headers={"x-api-key": "test-key"})
    assert response.status_code == 429
    assert response.json() == {"detail": "Too Many Requests"}
    assert "retry-after" in response.headers

    # Deprecated key
    response = client.get("/items/", headers={"x-api-key": "old-key"})
    assert response.status_code == 200
    assert response.json() == {"key": "old-key"}
    assert "warning" in response.headers
    assert response.headers["warning"] == '299 - "Deprecated API Key"'
