from collections.abc import Callable

from fastapi import APIRouter, FastAPI, Request
from fastapi.testclient import TestClient
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
        async def send_with_header(message):
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


def callable_header_middleware(
    app: ASGIApp,
    *,
    value: str,
) -> Callable[[Scope, Receive, Send], object]:
    async def wrapped(scope: Scope, receive: Receive, send: Send) -> None:
        async def send_with_header(message):
            if message["type"] == "http.response.start":
                message.setdefault("headers", []).append(
                    (b"x-callable-router", value.encode("latin-1"))
                )
            await send(message)

        await app(scope, receive, send_with_header)

    return wrapped


def test_router_middleware_is_isolated_to_router_routes() -> None:
    app = FastAPI()
    router = APIRouter(middleware=[HeaderMiddleware])

    @router.get("/router")
    def router_route() -> dict[str, bool]:
        return {"ok": True}

    @app.get("/app")
    def app_route() -> dict[str, bool]:
        return {"ok": True}

    app.include_router(router)
    client = TestClient(app)

    assert client.get("/router").headers["x-router"] == "on"
    assert "x-router" not in client.get("/app").headers


def test_add_middleware_preserves_registration_order() -> None:
    app = FastAPI()
    router = APIRouter()

    @router.get("/order")
    def ordered(request: Request) -> dict[str, list[str]]:
        return {"order": request.scope["order"]}

    router.add_middleware(ScopeOrderMiddleware, name="first")
    router.add_middleware(ScopeOrderMiddleware, name="second")
    app.include_router(router)

    assert TestClient(app).get("/order").json() == {"order": ["first", "second"]}


def test_callable_router_middleware_works() -> None:
    app = FastAPI()
    router = APIRouter()
    router.add_middleware(callable_header_middleware, value="yes")

    @router.get("/callable")
    def callable_route() -> dict[str, bool]:
        return {"ok": True}

    app.include_router(router)

    assert TestClient(app).get("/callable").headers["x-callable-router"] == "yes"


def test_include_router_preserves_nested_router_middleware() -> None:
    app = FastAPI()
    outer = APIRouter()
    inner = APIRouter(middleware=[HeaderMiddleware])

    @inner.get("/nested")
    def nested_route() -> dict[str, bool]:
        return {"ok": True}

    outer.include_router(inner, prefix="/inner")
    app.include_router(outer, prefix="/api")

    assert TestClient(app).get("/api/inner/nested").headers["x-router"] == "on"
