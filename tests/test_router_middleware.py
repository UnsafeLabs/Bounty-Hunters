from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient
from starlette.responses import PlainTextResponse


class HeaderMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        async def send_with_header(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.append((b"x-class", b"yes"))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_header)


def test_router_middleware_isolated_and_preserved_by_include_router():
    router = APIRouter(middleware=[HeaderMiddleware])
    other = APIRouter()

    @router.get("/one")
    def one():
        return {"ok": True}

    @other.get("/two")
    def two():
        return {"ok": True}

    app = FastAPI()
    app.include_router(router, prefix="/api")
    app.include_router(other, prefix="/other")
    client = TestClient(app)
    assert client.get("/api/one").headers["x-class"] == "yes"
    assert "x-class" not in client.get("/other/two").headers


def test_add_middleware_and_order():
    events = []

    async def first(request, call_next):
        events.append("first-before")
        response = await call_next(request)
        events.append("first-after")
        return response

    async def second(request, call_next):
        events.append("second-before")
        response = await call_next(request)
        events.append("second-after")
        return response

    router = APIRouter()
    router.add_middleware(first)
    router.add_middleware(second)

    @router.get("/")
    def root():
        events.append("endpoint")
        return PlainTextResponse("ok")

    app = FastAPI()
    app.include_router(router)
    assert TestClient(app).get("/").text == "ok"
    assert events == ["first-before", "second-before", "endpoint", "second-after", "first-after"]


def test_callable_middleware_is_adapted_as_simple_dispatch():
    async def middleware(request, call_next):
        response = await call_next(request)
        response.headers["x-callable"] = "yes"
        return response

    router = APIRouter(middleware=[middleware])

    @router.get("/")
    def root():
        return {"ok": True}

    app = FastAPI()
    app.include_router(router)
    assert TestClient(app).get("/").headers["x-callable"] == "yes"
