"""Tests for FastAPITestClient auth and WebSocket helpers (issue #804).

Uses Starlette ASGI apps so tests run without requiring the full local
FastAPI package tree (which may need Python 3.10+).
"""

from __future__ import annotations

import base64
import importlib.util
import sys
from pathlib import Path

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route, WebSocketRoute
from starlette.testclient import TestClient
from starlette.websockets import WebSocket, WebSocketDisconnect

# Load FastAPITestClient from local package path without importing fastapi/__init__.py
_ROOT = Path(__file__).resolve().parents[1]
_TC_PATH = _ROOT / "fastapi" / "testclient.py"
_spec = importlib.util.spec_from_file_location("fastapi_testclient_local", _TC_PATH)
assert _spec and _spec.loader
_mod = importlib.util.module_from_spec(_spec)
sys.modules["fastapi_testclient_local"] = _mod
_spec.loader.exec_module(_mod)
FastAPITestClient = _mod.FastAPITestClient


async def public(request: Request):
    return JSONResponse({"ok": True})


async def secure(request: Request):
    auth = request.headers.get("authorization")
    if not auth or not auth.lower().startswith("bearer "):
        return JSONResponse({"detail": "missing bearer"}, status_code=401)
    token = auth.split(" ", 1)[1]
    return JSONResponse({"token": token})


async def basic(request: Request):
    return JSONResponse({"authorization": request.headers.get("authorization")})


async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        data = await websocket.receive_text()
        auth = websocket.headers.get("authorization", "")
        await websocket.send_text(f"{auth}|{data}")
    except WebSocketDisconnect:
        pass


def create_app() -> Starlette:
    return Starlette(
        routes=[
            Route("/public", public),
            Route("/secure", secure),
            Route("/basic", basic),
            WebSocketRoute("/ws", ws_endpoint),
        ]
    )


def test_existing_testclient_still_usable():
    app = create_app()
    client = TestClient(app)
    assert client.get("/public").status_code == 200


def test_authenticate_sets_bearer_for_following_requests():
    app = create_app()
    client = FastAPITestClient(app)
    assert client.get("/secure").status_code == 401
    client.authenticate("secret-token")
    r = client.get("/secure")
    assert r.status_code == 200
    assert r.json()["token"] == "secret-token"
    assert client.get("/secure").json()["token"] == "secret-token"


def test_authenticate_replaces_previous_token():
    app = create_app()
    client = FastAPITestClient(app)
    client.authenticate("first")
    client.authenticate("second")
    assert client.get("/secure").json()["token"] == "second"


def test_reset_auth_clears_token():
    app = create_app()
    client = FastAPITestClient(app)
    client.authenticate("tok")
    client.reset_auth()
    assert client.get("/secure").status_code == 401


def test_authenticate_basic_encodes_header():
    app = create_app()
    client = FastAPITestClient(app)
    client.authenticate_basic("alice", "wonderland")
    expected = "Basic " + base64.b64encode(b"alice:wonderland").decode("ascii")
    assert client._auth_headers["Authorization"] == expected
    r = client.get("/basic")
    assert r.json()["authorization"] == expected


def test_assert_status_ok_and_fail():
    app = create_app()
    client = FastAPITestClient(app)
    r = client.assert_status("GET", "/public", 200)
    assert r.json()["ok"] is True
    raised = False
    try:
        client.assert_status("GET", "/public", 500)
    except AssertionError as e:
        raised = True
        assert "Expected status 500" in str(e)
        assert "got 200" in str(e)
    assert raised


def test_ws_connect_with_headers():
    app = create_app()
    client = FastAPITestClient(app)
    client.authenticate("ws-token")
    with client.ws_connect("/ws") as ws:
        ws.send_text("hello")
        msg = ws.receive_text()
    assert "Bearer ws-token" in msg
    assert "hello" in msg
