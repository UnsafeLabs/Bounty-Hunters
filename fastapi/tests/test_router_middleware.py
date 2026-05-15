from collections.abc import Awaitable, Callable

from fastapi import APIRouter, FastAPI, Request, Response
from fastapi.middleware import Middleware
from fastapi.testclient import TestClient
from starlette.middleware.base import BaseHTTPMiddleware


class HeaderMiddleware(BaseHTTPMiddleware):
    def __init__(
        self,
        app,
        header_name: str = "x-router-middleware",
        header_value: str = "yes",
    ):
        super().__init__(app)
        self.header_name = header_name
        self.header_value = header_value

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        response.headers[self.header_name] = self.header_value
        return response


async def callable_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    response = await call_next(request)
    response.headers["x-callable-middleware"] = "yes"
    return response


def test_router_middleware_isolated_to_router_routes():
    app = FastAPI()
    router = APIRouter(middleware=[HeaderMiddleware, callable_middleware])
    other_router = APIRouter()

    @router.get("/router")
    def router_endpoint():
        return {"router": True}

    @other_router.get("/other")
    def other_endpoint():
        return {"other": True}

    @app.get("/app")
    def app_endpoint():
        return {"app": True}

    app.include_router(router)
    app.include_router(other_router)

    client = TestClient(app)

    router_response = client.get("/router")
    assert router_response.status_code == 200
    assert router_response.headers["x-router-middleware"] == "yes"
    assert router_response.headers["x-callable-middleware"] == "yes"

    other_response = client.get("/other")
    assert other_response.status_code == 200
    assert "x-router-middleware" not in other_response.headers
    assert "x-callable-middleware" not in other_response.headers

    app_response = client.get("/app")
    assert app_response.status_code == 200
    assert "x-router-middleware" not in app_response.headers
    assert "x-callable-middleware" not in app_response.headers


def test_router_middleware_order_follows_declaration_order():
    app = FastAPI()

    async def first(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        request.state.order = ["first-before"]
        response = await call_next(request)
        request.state.order.append("first-after")
        response.headers["x-middleware-order"] = ",".join(request.state.order)
        return response

    async def second(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        request.state.order.append("second-before")
        response = await call_next(request)
        request.state.order.append("second-after")
        response.headers["x-middleware-order"] = ",".join(request.state.order)
        return response

    router = APIRouter(middleware=[first, second])

    @router.get("/order")
    def read_order(request: Request):
        request.state.order.append("endpoint")
        return {"ok": True}

    app.include_router(router)

    response = TestClient(app).get("/order")
    assert response.status_code == 200
    assert (
        response.headers["x-middleware-order"]
        == "first-before,second-before,endpoint,second-after,first-after"
    )


def test_router_add_middleware_applies_to_existing_routes():
    app = FastAPI()
    router = APIRouter()

    @router.get("/added")
    def added_endpoint():
        return {"added": True}

    router.add_middleware(
        HeaderMiddleware,
        header_name="x-added-middleware",
        header_value="yes",
    )

    app.include_router(router)

    response = TestClient(app).get("/added")
    assert response.status_code == 200
    assert response.headers["x-added-middleware"] == "yes"


def test_include_router_preserves_nested_router_middleware():
    app = FastAPI()
    parent_router = APIRouter(
        prefix="/parent",
        middleware=[
            Middleware(
                HeaderMiddleware,
                header_name="x-parent-middleware",
                header_value="yes",
            )
        ],
    )
    child_router = APIRouter(middleware=[callable_middleware])

    @child_router.get("/child")
    def child_endpoint():
        return {"child": True}

    parent_router.include_router(child_router)
    app.include_router(parent_router)

    response = TestClient(app).get("/parent/child")
    assert response.status_code == 200
    assert response.headers["x-parent-middleware"] == "yes"
    assert response.headers["x-callable-middleware"] == "yes"
