from collections.abc import Callable

from fastapi import APIRouter, FastAPI, Request
from fastapi.testclient import TestClient
from starlette.middleware import Middleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response


class HeaderMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, *, header: str, value: str):
        super().__init__(app)
        self.header = header
        self.value = value

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response = await call_next(request)
        response.headers[self.header] = self.value
        return response


async def callable_middleware(request: Request, call_next: Callable) -> Response:
    response = await call_next(request)
    response.headers["x-callable"] = "yes"
    return response


def make_order_middleware(name: str):
    async def middleware(request: Request, call_next: Callable) -> Response:
        request.scope.setdefault("router_middleware_order", []).append(name)
        response = await call_next(request)
        response.headers["x-order"] = ",".join(request.scope["router_middleware_order"])
        return response

    return middleware


def test_router_middleware_isolated_to_router_routes():
    app = FastAPI()
    router = APIRouter(
        middleware=[Middleware(HeaderMiddleware, header="x-router", value="yes")]
    )

    @router.get("/router")
    def router_route():
        return {"route": "router"}

    @app.get("/app")
    def app_route():
        return {"route": "app"}

    app.include_router(router)
    client = TestClient(app)

    router_response = client.get("/router")
    app_response = client.get("/app")

    assert router_response.headers["x-router"] == "yes"
    assert "x-router" not in app_response.headers


def test_callable_middleware_and_order_follow_added_order():
    app = FastAPI()
    router = APIRouter(
        middleware=[
            Middleware(make_order_middleware("first")),
            Middleware(make_order_middleware("second")),
        ]
    )
    router.add_middleware(callable_middleware)

    @router.get("/ordered")
    def ordered_route():
        return {"ok": True}

    app.include_router(router)
    response = TestClient(app).get("/ordered")

    assert response.headers["x-order"] == "first,second"
    assert response.headers["x-callable"] == "yes"


def test_include_router_preserves_child_router_middleware():
    app = FastAPI()
    child = APIRouter(
        middleware=[Middleware(HeaderMiddleware, header="x-child", value="yes")]
    )
    parent = APIRouter(prefix="/parent")

    @child.get("/child")
    def child_route():
        return {"ok": True}

    parent.include_router(child)
    app.include_router(parent)
    response = TestClient(app).get("/parent/child")

    assert response.headers["x-child"] == "yes"


def test_parent_router_middleware_applies_to_included_routes():
    app = FastAPI()
    child = APIRouter()
    parent = APIRouter(
        prefix="/parent",
        middleware=[Middleware(HeaderMiddleware, header="x-parent", value="yes")],
    )

    @child.get("/child")
    def child_route():
        return {"ok": True}

    parent.include_router(child)
    app.include_router(parent)
    response = TestClient(app).get("/parent/child")

    assert response.headers["x-parent"] == "yes"


def test_add_middleware_rewraps_existing_routes():
    app = FastAPI()
    router = APIRouter()

    @router.get("/late")
    def late_route():
        return {"ok": True}

    router.add_middleware(HeaderMiddleware, header="x-late", value="yes")
    app.include_router(router)
    response = TestClient(app).get("/late")

    assert response.headers["x-late"] == "yes"


def test_router_middleware_applies_to_plain_routes():
    app = FastAPI()
    router = APIRouter(
        middleware=[Middleware(HeaderMiddleware, header="x-plain", value="yes")]
    )

    @router.route("/plain")
    async def plain_route(request: Request):
        return JSONResponse({"ok": True})

    app.include_router(router)
    response = TestClient(app).get("/plain")

    assert response.status_code == 200, response.text
    assert response.headers["x-plain"] == "yes"
