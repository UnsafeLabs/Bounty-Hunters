from fastapi import FastAPI, APIRouter
from fastapi.testclient import TestClient
from starlette.middleware.base import BaseHTTPMiddleware

router = APIRouter()

@router.get("/router-only")
def router_route():
    return {"from": "router"}

main_app = FastAPI()
main_app.include_router(router)

router_with_mw = APIRouter()

@router_with_mw.get("/mw-protected")
def mw_route():
    return {"protected": True}

class TestMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Test"] = "router-mw"
        return response

router_with_mw.add_middleware(TestMiddleware)

app2 = FastAPI()
app2.include_router(router_with_mw)

@app2.get("/unprotected")
def unprotected():
    return {"open": True}


class TestRouterMiddleware:
    def test_router_without_middleware_still_works(self):
        client = TestClient(main_app)
        resp = client.get("/router-only")
        assert resp.status_code == 200

    def test_router_middleware_applies_to_router_routes(self):
        client = TestClient(app2)
        resp = client.get("/mw-protected")
        assert resp.status_code == 200
        assert resp.headers.get("x-test") == "router-mw"

    def test_unprotected_route_no_middleware(self):
        client = TestClient(app2)
        resp = client.get("/unprotected")
        assert resp.status_code == 200
        assert resp.headers.get("x-test") is None
