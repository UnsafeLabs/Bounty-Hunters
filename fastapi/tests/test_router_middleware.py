"""Tests for router-level middleware support."""
import pytest
from fastapi import FastAPI, APIRouter
from fastapi.testclient import TestClient
from fastapi.middleware.router import (
    MiddlewareChain,
    apply_router_middleware,
    create_path_middleware,
)


@pytest.fixture
def app():
    app = FastAPI()
    
    @app.get("/public")
    async def public():
        return {"message": "public"}
    
    return app


class TestMiddlewareChain:
    def test_use_returns_self(self):
        chain = MiddlewareChain()
        result = chain.use(lambda r, n: n(r))
        assert result is chain

    def test_chain_accumulates_middleware(self):
        chain = MiddlewareChain()
        chain.use(lambda r, n: n(r))
        chain.use(lambda r, n: n(r))
        assert len(chain.middleware) == 2

    def test_empty_chain(self):
        chain = MiddlewareChain()
        assert len(chain.middleware) == 0


class TestCreatePathMiddleware:
    def test_path_middleware_only_matches_prefix(self):
        from starlette.testclient import TestClient as StarletteClient
        
        call_log = []
        
        async def logging_middleware(request, call_next):
            call_log.append(request.url.path)
            return await call_next(request)
        
        app = FastAPI()
        
        @app.get("/api/data")
        async def api_data():
            return {"data": True}
        
        @app.get("/other")
        async def other():
            return {"data": False}
        
        path_mw = create_path_middleware("/api", logging_middleware)
        
        from starlette.middleware.base import BaseHTTPMiddleware
        app.add_middleware(BaseHTTPMiddleware, dispatch=path_mw)
        
        client = TestClient(app)
        client.get("/api/data")
        client.get("/other")
        
        assert "/api/data" in call_log
        assert "/other" not in call_log


class TestApplyRouterMiddleware:
    def test_apply_returns_router(self):
        router = APIRouter()
        result = apply_router_middleware(router)
        assert result is router
