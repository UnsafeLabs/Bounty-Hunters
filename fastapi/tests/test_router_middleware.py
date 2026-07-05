from collections.abc import Callable

from fastapi import APIRouter, FastAPI, Request, Response
from fastapi.testclient import TestClient
from starlette.middleware import Middleware
from starlette.middleware.base import BaseHTTPMiddleware


def header_middleware(header: str, value: str) -> Callable:
    async def middleware(request: Request, call_next: Callable) -> Response:
        response = await call_next(request)
        response.headers[header] = value
        return response

    return middleware


def record_middleware(name: str) -> Callable:
    async def middleware(request: Request, call_next: Callable) -> Response:
        request.scope.setdefault("router_middleware_order", []).append(name)
        return await call_next(request)

    return middleware


class ClassHeaderMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, *, header: str, value: str) -> None:
        super().__init__(app)
        self.header = header
        self.value = value

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response = await call_next(request)
        response.headers[self.header] = self.value
        return response


def test_router_middleware_is_scoped_to_router_routes() -> None:
    app = FastAPI()
    router = APIRouter(middleware=[header_middleware("x-router", "scoped")])
    other_router = APIRouter()

    @router.get("/scoped")
    async def scoped() -> dict[str, bool]:
        return {"ok": True}

    @other_router.get("/other")
    async def other() -> dict[str, bool]:
        return {"ok": True}

    @app.get("/app")
    async def app_route() -> dict[str, bool]:
        return {"ok": True}

    app.include_router(router)
    app.include_router(other_router)

    client = TestClient(app)

    assert client.get("/scoped").headers["x-router"] == "scoped"
    assert "x-router" not in client.get("/other").headers
    assert "x-router" not in client.get("/app").headers


def test_router_middleware_order_and_include_router_preservation() -> None:
    app = FastAPI()
    parent_router = APIRouter(middleware=[record_middleware("parent")])
    child_router = APIRouter(middleware=[record_middleware("child")])

    @child_router.get("/leaf")
    async def leaf(request: Request) -> dict[str, list[str]]:
        return {"order": request.scope["router_middleware_order"]}

    parent_router.include_router(child_router, prefix="/child")
    app.include_router(parent_router, prefix="/parent")

    response = TestClient(app).get("/parent/child/leaf")

    assert response.json() == {"order": ["parent", "child"]}


def test_router_supports_class_and_callable_middleware() -> None:
    router = APIRouter(
        middleware=[
            Middleware(ClassHeaderMiddleware, header="x-class", value="class"),
            header_middleware("x-callable", "callable"),
        ]
    )
    app = FastAPI()

    @router.get("/combined")
    async def combined() -> dict[str, bool]:
        return {"ok": True}

    app.include_router(router)
    response = TestClient(app).get("/combined")

    assert response.headers["x-class"] == "class"
    assert response.headers["x-callable"] == "callable"


def test_add_middleware_wraps_existing_router_routes() -> None:
    router = APIRouter()
    app = FastAPI()

    @router.get("/late")
    async def late() -> dict[str, bool]:
        return {"ok": True}

    router.add_middleware(
        BaseHTTPMiddleware,
        dispatch=header_middleware("x-added-after-route", "yes"),
    )
    app.include_router(router)

    response = TestClient(app).get("/late")

    assert response.headers["x-added-after-route"] == "yes"
