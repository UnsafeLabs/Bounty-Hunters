from fastapi import APIRouter, FastAPI
from fastapi.middleware import Middleware
from fastapi.testclient import TestClient
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request


class HeaderMiddleware:
    def __init__(self, app, header_name="x-router", header_value="enabled"):
        self.app = app
        self.header_name = header_name
        self.header_value = header_value

    async def __call__(self, scope, receive, send):
        async def send_with_header(message):
            if message["type"] == "http.response.start":
                message["headers"].append(
                    (self.header_name.encode(), self.header_value.encode())
                )
            await send(message)

        await self.app(scope, receive, send_with_header)


def test_router_middleware_isolated_to_router_routes():
    router = APIRouter(middleware=[Middleware(HeaderMiddleware)])
    other_router = APIRouter()
    app = FastAPI()

    @router.get("/scoped")
    def scoped():
        return {"ok": True}

    @other_router.get("/plain")
    def plain():
        return {"ok": True}

    app.include_router(router)
    app.include_router(other_router)
    client = TestClient(app)

    assert client.get("/scoped").headers["x-router"] == "enabled"
    assert "x-router" not in client.get("/plain").headers


def test_router_middleware_order_follows_addition_order():
    events = []

    class Recorder(BaseHTTPMiddleware):
        def __init__(self, app, name):
            super().__init__(app)
            self.name = name

        async def dispatch(self, request: Request, call_next):
            events.append(f"{self.name}:before")
            response = await call_next(request)
            events.append(f"{self.name}:after")
            return response

    router = APIRouter(
        middleware=[
            Middleware(Recorder, name="first"),
            Middleware(Recorder, name="second"),
        ]
    )
    app = FastAPI()

    @router.get("/ordered")
    def ordered():
        return {"ok": True}

    app.include_router(router)
    TestClient(app).get("/ordered")

    assert events == ["first:before", "second:before", "second:after", "first:after"]


def test_include_router_preserves_router_middleware():
    child = APIRouter(middleware=[Middleware(HeaderMiddleware, header_value="child")])
    parent = APIRouter()
    app = FastAPI()

    @child.get("/child")
    def child_route():
        return {"ok": True}

    parent.include_router(child, prefix="/nested")
    app.include_router(parent)
    response = TestClient(app).get("/nested/child")

    assert response.headers["x-router"] == "child"


def test_add_middleware_accepts_simple_callable_middleware():
    async def add_header(request: Request, call_next):
        response = await call_next(request)
        response.headers["x-callable"] = "yes"
        return response

    router = APIRouter()
    router.add_middleware(add_header)
    app = FastAPI()

    @router.get("/callable")
    def callable_route():
        return {"ok": True}

    app.include_router(router)

    assert TestClient(app).get("/callable").headers["x-callable"] == "yes"
