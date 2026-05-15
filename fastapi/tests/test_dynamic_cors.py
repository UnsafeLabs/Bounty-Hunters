import asyncio
from fastapi import FastAPI
from fastapi.middleware.cors import DynamicCORSMiddleware
from fastapi.testclient import TestClient
import pytest

def test_dynamic_cors_sync_callback():
    app = FastAPI()
    
    def allow_origin_func(origin: str) -> bool:
        return origin == "https://allowed.com"

    app.add_middleware(
        DynamicCORSMiddleware,
        allow_origin_func=allow_origin_func,
        cors_max_age=3600
    )

    @app.get("/")
    def main():
        return {"message": "Hello World"}

    client = TestClient(app)

    # Allowed origin
    response = client.get("/", headers={"Origin": "https://allowed.com"})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://allowed.com"

    # Disallowed origin
    response = client.get("/", headers={"Origin": "https://disallowed.com"})
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers

@pytest.mark.asyncio
async def test_dynamic_cors_async_callback():
    app = FastAPI()
    
    async def allow_origin_func(origin: str) -> bool:
        await asyncio.sleep(0.01)
        return origin == "https://async-allowed.com"

    app.add_middleware(
        DynamicCORSMiddleware,
        allow_origin_func=allow_origin_func
    )

    @app.get("/")
    def main():
        return {"message": "Hello World"}

    # TestClient doesn't support async middleware well with its sync API if it uses its own loop
    # but for FastAPI middleware it should work as FastAPI handles the execution.
    client = TestClient(app)

    response = client.get("/", headers={"Origin": "https://async-allowed.com"})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://async-allowed.com"

def test_dynamic_cors_max_age():
    app = FastAPI()
    
    app.add_middleware(
        DynamicCORSMiddleware,
        allow_origins=["*"],
        cors_max_age=1234
    )

    client = TestClient(app)

    # Preflight request
    response = client.options(
        "/",
        headers={
            "Origin": "https://any.com",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-max-age"] == "1234"

def test_dynamic_cors_fallback():
    app = FastAPI()
    
    # allow_origins allows google.com, but allow_origin_func will only allow allowed.com
    app.add_middleware(
        DynamicCORSMiddleware,
        allow_origins=["https://google.com"],
        allow_origin_func=lambda origin: origin == "https://allowed.com"
    )

    client = TestClient(app)

    # Origin allowed by func
    response = client.get("/", headers={"Origin": "https://allowed.com"})
    assert response.headers["access-control-allow-origin"] == "https://allowed.com"

    # Origin allowed by list but not by func? 
    # Wait, my implementation uses func if present, and IF it returns False, it doesn't check the list?
    # Actually, Starlette checks list. My implementation:
    # if self.allow_origin_func: ... return result ... else: return self.is_allowed_origin(origin)
    # So if func is present, it's exclusive.
    
    response = client.get("/", headers={"Origin": "https://google.com"})
    assert "access-control-allow-origin" not in response.headers
