import pytest
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.cors import DynamicCORSMiddleware
from fastapi.testclient import TestClient

app = FastAPI()

@app.get("/")
def root():
    return {"hello": "world"}

dynamic_app = FastAPI()
dynamic_app.add_middleware(
    DynamicCORSMiddleware,
    allow_origin_func=lambda origin: origin == "https://example.com",
    cors_max_age=3600,
)

@dynamic_app.get("/")
def dynamic_root():
    return {"hello": "dynamic"}

async_app = FastAPI()

async def async_allow(origin: str) -> bool:
    return origin.endswith(".example.com")

async_app.add_middleware(DynamicCORSMiddleware, allow_origin_func=async_allow)

@async_app.get("/")
def async_root():
    return {"hello": "async"}


class TestDynamicCORSMiddleware:
    def test_static_cors_still_works(self):
        static_app = FastAPI()
        static_app.add_middleware(
            CORSMiddleware,
            allow_origins=["https://static.example.com"],
            allow_methods=["GET"],
            allow_headers=["*"],
        )

        @static_app.get("/")
        def root():
            return {"ok": True}

        client = TestClient(static_app)
        resp = client.get("/", headers={"Origin": "https://static.example.com"})
        assert resp.status_code == 200
        assert resp.headers.get("access-control-allow-origin") == "https://static.example.com"

    def test_dynamic_allow(self):
        client = TestClient(dynamic_app)
        resp = client.get("/", headers={"Origin": "https://example.com"})
        assert resp.status_code == 200
        assert resp.headers.get("access-control-allow-origin") == "https://example.com"

    def test_dynamic_deny(self):
        client = TestClient(dynamic_app)
        resp = client.get("/", headers={"Origin": "https://evil.com"})
        assert resp.status_code == 200
        assert resp.headers.get("access-control-allow-origin") is None or resp.headers.get("access-control-allow-origin") == "null"

    def test_cors_max_age_header(self):
        client = TestClient(dynamic_app)
        resp = client.options("/", headers={
            "Origin": "https://example.com",
            "Access-Control-Request-Method": "GET",
        })
        assert resp.headers.get("access-control-max-age") == "3600"

    @pytest.mark.asyncio
    async def test_async_callback(self):
        client = TestClient(async_app)
        resp = client.get("/", headers={"Origin": "https://sub.example.com"})
        assert resp.status_code == 200
