from collections.abc import Callable

from fastapi import APIRouter, FastAPI, Request, Response, WebSocket
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from starlette.middleware import Middleware
from starlette.types import ASGIApp, Receive, Scope, Send


class HeaderMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        *,
        name: str = "x-router",
        value: str = "on",
    ) -> None:
        self.app = app
        self.name = name.encode("latin-1")
        self.value = value.encode("latin-1")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        async def send_with_header(message: dict[str, object]) -> None:
            if message["type"] == "http.response.start":
                message.setdefault("headers", []).append((self.name, self.value))
            await send(message)

        await self.app(scope, receive, send_with_header)


class ScopeOrderMiddleware:
    def __init__(self, app: ASGIApp, *, name: str) -> None:
        self.app = app
        self.name = name

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        scope.setdefault("order", []).append(self.name)
        await self.app(scope, receive, send)


async def dispatch_header_middleware(
    request: Request,
    call_next: Callable[[Request], object],
) -> Response:
    response = await call_next(request)
    response.headers["x-dispatch-router"] = "yes"
    return response


def test_router_middleware_is_isolated_to_router_routes() -> None:
    app = FastAPI()
    first_router = APIRouter(middleware=[HeaderMiddleware])
    second_router = APIRouter()

    @first_router.get("/first")
    def first_route() -> dict[str, bool]:
        return {"ok": True}

    @second_router.get("/second")
    def second_route() -> dict[str, bool]:
        return {"ok": True}

    @app.get("/app")
    def app_route() -> dict[str, bool]:
        return {"ok": True}

    app.include_router(first_router)
    app.include_router(second_router)
    client = TestClient(app)

    assert client.get("/first").headers["x-router"] == "on"
    assert "x-router" not in client.get("/second").headers
    assert "x-router" not in client.get("/app").headers


def test_router_middleware_accepts_starlette_middleware_instances() -> None:
    app = FastAPI()
    router = APIRouter(
        middleware=[
            Middleware(HeaderMiddleware, name="x-starlette-router", value="yes")
        ]
    )

    @router.get("/middleware-instance")
    def route() -> dict[str, bool]:
        return {"ok": True}

    app.include_router(router)

    assert (
        TestClient(app).get("/middleware-instance").headers["x-starlette-router"]
        == "yes"
    )


def test_add_middleware_preserves_registration_order_for_existing_routes() -> None:
    app = FastAPI()
    router = APIRouter()

    @router.get("/order")
    def ordered(request: Request) -> dict[str, list[str]]:
        return {"order": request.scope["order"]}

    router.add_middleware(ScopeOrderMiddleware, name="first")
    router.add_middleware(ScopeOrderMiddleware, name="second")
    app.include_router(router)

    assert TestClient(app).get("/order").json() == {"order": ["first", "second"]}


def test_callable_dispatch_router_middleware_works() -> None:
    app = FastAPI()
    router = APIRouter(middleware=[dispatch_header_middleware])

    @router.get("/callable")
    def callable_route() -> dict[str, bool]:
        return {"ok": True}

    app.include_router(router)

    assert TestClient(app).get("/callable").headers["x-dispatch-router"] == "yes"


def test_router_middleware_wraps_plain_starlette_routes() -> None:
    app = FastAPI()
    router = APIRouter(middleware=[HeaderMiddleware])

    @router.route("/plain")
    def plain_route(request: Request) -> JSONResponse:
        return JSONResponse({"path": request.url.path})

    app.include_router(router)

    response = TestClient(app).get("/plain")
    assert response.json() == {"path": "/plain"}
    assert response.headers["x-router"] == "on"


def test_include_router_preserves_parent_and_child_middleware_order() -> None:
    app = FastAPI()
    outer = APIRouter(middleware=[Middleware(ScopeOrderMiddleware, name="outer")])
    inner = APIRouter(middleware=[Middleware(ScopeOrderMiddleware, name="inner")])

    @inner.get("/nested")
    def nested_route(request: Request) -> dict[str, list[str]]:
        return {"order": request.scope["order"]}

    outer.include_router(inner, prefix="/inner")
    app.include_router(outer, prefix="/api")

    assert TestClient(app).get("/api/inner/nested").json() == {
        "order": ["outer", "inner"]
    }


def test_router_middleware_wraps_websocket_routes() -> None:
    app = FastAPI()
    router = APIRouter(middleware=[Middleware(ScopeOrderMiddleware, name="ws")])

    @router.websocket("/ws")
    async def websocket_route(websocket: WebSocket) -> None:
        await websocket.accept()
        await websocket.send_json({"order": websocket.scope["order"]})
        await websocket.close()

    app.include_router(router)

    with TestClient(app).websocket_connect("/ws") as websocket:
        assert websocket.receive_json() == {"order": ["ws"]}
