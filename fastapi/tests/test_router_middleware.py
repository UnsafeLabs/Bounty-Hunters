from fastapi import APIRouter, FastAPI
from fastapi.middleware import Middleware
from fastapi.testclient import TestClient
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class TagMiddleware:
    """Records that it ran by prepending its name to the ``x-mw`` header.

    Prepending (instead of appending) means the resulting header, read left to
    right, lists middleware from the outermost layer to the innermost one.
    """

    def __init__(self, app: ASGIApp, *, name: str) -> None:
        self.app = app
        self.name = name

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                existing = headers.get("x-mw")
                headers["x-mw"] = f"{self.name},{existing}" if existing else self.name
            await send(message)

        await self.app(scope, receive, send_wrapper)


def test_router_middleware_wraps_its_own_routes_only() -> None:
    app = FastAPI()

    router_with = APIRouter(middleware=[Middleware(TagMiddleware, name="A")])

    @router_with.get("/with")
    def with_mw() -> dict[str, str]:
        return {"ok": "with"}

    router_without = APIRouter()

    @router_without.get("/without")
    def without_mw() -> dict[str, str]:
        return {"ok": "without"}

    app.include_router(router_with)
    app.include_router(router_without)

    client = TestClient(app)

    response = client.get("/with")
    assert response.status_code == 200, response.text
    assert response.json() == {"ok": "with"}
    assert response.headers["x-mw"] == "A"

    # The middleware must not leak onto routes from another router.
    response = client.get("/without")
    assert response.status_code == 200, response.text
    assert "x-mw" not in response.headers


def test_router_middleware_order_outermost_first() -> None:
    app = FastAPI()
    router = APIRouter(
        middleware=[
            Middleware(TagMiddleware, name="outer"),
            Middleware(TagMiddleware, name="inner"),
        ]
    )

    @router.get("/order")
    def endpoint() -> dict[str, bool]:
        return {"ok": True}

    app.include_router(router)
    client = TestClient(app)

    response = client.get("/order")
    assert response.status_code == 200, response.text
    # First entry in the list is the outermost layer.
    assert response.headers["x-mw"] == "outer,inner"


def test_router_middleware_nested_routers_compound() -> None:
    app = FastAPI()
    inner = APIRouter(middleware=[Middleware(TagMiddleware, name="inner")])

    @inner.get("/deep")
    def endpoint() -> dict[str, bool]:
        return {"ok": True}

    outer = APIRouter(middleware=[Middleware(TagMiddleware, name="outer")])
    outer.include_router(inner)
    app.include_router(outer)

    client = TestClient(app)

    response = client.get("/deep")
    assert response.status_code == 200, response.text
    # The outer router's middleware wraps the inner router's middleware.
    assert response.headers["x-mw"] == "outer,inner"


def test_router_without_middleware_is_unaffected() -> None:
    app = FastAPI()
    default_router = APIRouter()
    empty_router = APIRouter(middleware=[])

    @default_router.get("/default")
    def default_endpoint() -> dict[str, bool]:
        return {"ok": True}

    @empty_router.get("/empty")
    def empty_endpoint() -> dict[str, bool]:
        return {"ok": True}

    app.include_router(default_router)
    app.include_router(empty_router)

    client = TestClient(app)

    for path in ("/default", "/empty"):
        response = client.get(path)
        assert response.status_code == 200, response.text
        assert "x-mw" not in response.headers


def test_router_middleware_accepts_simple_callable() -> None:
    app = FastAPI()

    def add_tag(inner: ASGIApp) -> ASGIApp:
        # A "simple callable" middleware: takes the ASGI app and returns a new
        # one wrapping it, without going through `Middleware(...)`.
        return TagMiddleware(inner, name="callable")

    router = APIRouter(middleware=[add_tag])

    @router.get("/callable")
    def endpoint() -> dict[str, bool]:
        return {"ok": True}

    app.include_router(router)
    client = TestClient(app)

    response = client.get("/callable")
    assert response.status_code == 200, response.text
    assert response.headers["x-mw"] == "callable"


def test_router_middleware_mixes_tuple_and_callable() -> None:
    app = FastAPI()

    router = APIRouter(
        middleware=[
            Middleware(TagMiddleware, name="tuple"),
            lambda inner: TagMiddleware(inner, name="callable"),
        ]
    )

    @router.get("/mixed")
    def endpoint() -> dict[str, bool]:
        return {"ok": True}

    app.include_router(router)
    client = TestClient(app)

    response = client.get("/mixed")
    assert response.status_code == 200, response.text
    # Both forms are honored, in list order (first entry outermost).
    assert response.headers["x-mw"] == "tuple,callable"


def test_router_add_middleware_mirrors_app() -> None:
    app = FastAPI()
    router = APIRouter()

    @router.get("/added")
    def endpoint() -> dict[str, bool]:
        return {"ok": True}

    router.add_middleware(TagMiddleware, name="added")
    app.include_router(router)
    client = TestClient(app)

    response = client.get("/added")
    assert response.status_code == 200, response.text
    assert response.headers["x-mw"] == "added"


def test_router_add_middleware_last_added_is_outermost() -> None:
    app = FastAPI()
    router = APIRouter()

    @router.get("/stacked")
    def endpoint() -> dict[str, bool]:
        return {"ok": True}

    # Mirroring `app.add_middleware`: the most recently added middleware becomes
    # the outermost layer.
    router.add_middleware(TagMiddleware, name="inner")
    router.add_middleware(TagMiddleware, name="outer")
    app.include_router(router)
    client = TestClient(app)

    response = client.get("/stacked")
    assert response.status_code == 200, response.text
    assert response.headers["x-mw"] == "outer,inner"
