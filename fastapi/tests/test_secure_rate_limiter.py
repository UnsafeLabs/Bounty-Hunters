import time
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from fastapi.security import SecureAPIRateLimiter

def test_valid_key_within_limit():
    auth = SecureAPIRateLimiter(name="x-api-key", rate_limit="100/minute")
    app = FastAPI()
    @app.get("/items/")
    def read_items(api_key: str = Depends(auth)):
        return {"api_key": api_key}
    client = TestClient(app)
    response = client.get("/items/", headers={"x-api-key": "valid-key"})
    assert response.status_code == 200
    assert response.json() == {"api_key": "valid-key"}

def test_key_exceeds_rate_limit():
    auth = SecureAPIRateLimiter(name="x-api-key", rate_limit="2/minute")
    app = FastAPI()
    @app.get("/items/")
    def read_items(api_key: str = Depends(auth)):
        return {"api_key": api_key}
    client = TestClient(app)
    key = "limited-key"
    assert client.get("/items/", headers={"x-api-key": key}).status_code == 200
    assert client.get("/items/", headers={"x-api-key": key}).status_code == 200
    r3 = client.get("/items/", headers={"x-api-key": key})
    assert r3.status_code == 429

def test_invalid_key_auto_error():
    auth = SecureAPIRateLimiter(name="x-api-key", rate_limit="100/minute")
    app = FastAPI()
    @app.get("/items/")
    def read_items(api_key: str = Depends(auth)):
        return {"api_key": api_key}
    client = TestClient(app)
    assert client.get("/items/").status_code == 401

def test_retry_after_header():
    auth = SecureAPIRateLimiter(name="x-api-key", rate_limit="1/minute")
    app = FastAPI()
    @app.get("/items/")
    def read_items(api_key: str = Depends(auth)):
        return {"api_key": api_key}
    client = TestClient(app)
    client.get("/items/", headers={"x-api-key": "retry-key"})
    r = client.get("/items/", headers={"x-api-key": "retry-key"})
    assert r.status_code == 429
    assert "Retry-After" in r.headers
    assert r.headers["Retry-After"].isdigit()
