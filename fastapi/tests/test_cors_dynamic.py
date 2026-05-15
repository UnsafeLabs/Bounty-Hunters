import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware, DynamicCORSMiddleware
from fastapi.testclient import TestClient

# ----------------------------------------------------------------
# Test 1: Dynamic allow via sync callback
# ----------------------------------------------------------------

app1 = FastAPI()


@app1.get("/")
async def root():
    return {"ok": True}


allowed_origins_sync = {"https://trusted.example.com", "https://app.example.com"}


def sync_allow(origin: str) -> bool:
    return origin in allowed_origins_sync


app1.add_middleware(
    DynamicCORSMiddleware,
    allow_origin_func=sync_allow,
    allow_methods=["GET"],
)


client1 = TestClient(app1)


def test_sync_dynamic_allow():
    """Dynamic callback allows a trusted origin."""
    resp = client1.get("/", headers={"Origin": "https://trusted.example.com"})
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "https://trusted.example.com"


def test_sync_dynamic_deny():
    """Dynamic callback denies an untrusted origin."""
    resp = client1.get("/", headers={"Origin": "https://evil.com"})
    assert resp.status_code == 200
    # No CORS header should be present
    assert resp.headers.get("access-control-allow-origin") is None


# ----------------------------------------------------------------
# Test 2: Dynamic allow via async callback
# ----------------------------------------------------------------

app2 = FastAPI()


@app2.get("/")
async def root2():
    return {"ok": True}


async def async_allow(origin: str) -> bool:
    await asyncio.sleep(0.01)
    return origin == "https://async-trusted.com"


app2.add_middleware(
    DynamicCORSMiddleware,
    allow_origin_func=async_allow,
    allow_methods=["GET"],
)


client2 = TestClient(app2)


def test_async_dynamic_allow():
    """Async callback allows origin."""
    resp = client2.get("/", headers={"Origin": "https://async-trusted.com"})
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "https://async-trusted.com"


def test_async_dynamic_deny():
    """Async callback denies origin."""
    resp = client2.get("/", headers={"Origin": "https://evil.com"})
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") is None


# ----------------------------------------------------------------
# Test 3: Fallback to static allow_origins when no func provided
# ----------------------------------------------------------------

app3 = FastAPI()


@app3.get("/")
async def root3():
    return {"ok": True}


app3.add_middleware(
    DynamicCORSMiddleware,
    allow_origins=["https://static-allowed.com"],
    allow_methods=["GET"],
)


client3 = TestClient(app3)


def test_fallback_to_static_list():
    """When allow_origin_func is None, the static allow_origins list is used."""
    resp = client3.get("/", headers={"Origin": "https://static-allowed.com"})
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "https://static-allowed.com"


def test_static_list_deny():
    """Origin not in static list should be denied."""
    resp = client3.get("/", headers={"Origin": "https://evil.com"})
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") is None


# ----------------------------------------------------------------
# Test 4: cors_max_age parameter
# ----------------------------------------------------------------

app4 = FastAPI()


@app4.get("/")
async def root4():
    return {"ok": True}


app4.add_middleware(
    DynamicCORSMiddleware,
    allow_origin_func=lambda o: o == "https://age-test.com",
    cors_max_age="3600",
    allow_methods=["GET"],
)


client4 = TestClient(app4)


def test_cors_max_age_in_preflight():
    """Preflight response includes Access-Control-Max-Age header."""
    resp = client4.options(
        "/",
        headers={
            "Origin": "https://age-test.com",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert resp.status_code == 200
    assert resp.headers.get("access-control-max-age") == "3600"


# ----------------------------------------------------------------
# Test 5: Existing CORSMiddleware import works unchanged
# ----------------------------------------------------------------

def test_existing_cors_middleware_import():
    """The original CORSMiddleware import still works."""
    assert CORSMiddleware is not None
    # DynamicCORSMiddleware should be a subclass
    assert issubclass(DynamicCORSMiddleware, CORSMiddleware)
