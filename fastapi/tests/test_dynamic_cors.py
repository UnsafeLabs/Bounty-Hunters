import pytest

from fastapi.middleware.cors import CORSMiddleware, DynamicCORSMiddleware
from starlette.middleware.cors import CORSMiddleware as StarletteCORSMiddleware


async def app(scope, receive, send):
    await send({"type": "http.response.start", "status": 200, "headers": []})
    await send({"type": "http.response.body", "body": b"ok"})


async def run_request(middleware, *, origin, method="GET", extra_headers=None):
    messages = []
    headers = [(b"origin", origin.encode())]
    for name, value in extra_headers or []:
        headers.append((name.encode(), value.encode()))
    scope = {"type": "http", "method": method, "headers": headers}

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        messages.append(message)

    await middleware(scope, receive, send)
    return messages


@pytest.mark.anyio
async def test_dynamic_allow_origin():
    middleware = DynamicCORSMiddleware(
        app,
        allow_origin_func=lambda origin: origin.endswith(".example.com"),
    )

    messages = await run_request(middleware, origin="https://api.example.com")

    assert (b"Access-Control-Allow-Origin".lower(), b"https://api.example.com") in [
        (name.lower(), value) for name, value in messages[0]["headers"]
    ]


@pytest.mark.anyio
async def test_dynamic_deny_origin():
    middleware = DynamicCORSMiddleware(app, allow_origin_func=lambda origin: False)

    messages = await run_request(middleware, origin="https://evil.example")

    assert messages[0]["headers"] == []


@pytest.mark.anyio
async def test_async_callback_is_awaited():
    async def allow(origin):
        return origin == "https://allowed.example"

    middleware = DynamicCORSMiddleware(app, allow_origin_func=allow)

    messages = await run_request(middleware, origin="https://allowed.example")

    assert any(name.lower() == b"access-control-allow-origin" for name, _ in messages[0]["headers"])


@pytest.mark.anyio
async def test_static_fallback_and_preflight_max_age():
    middleware = DynamicCORSMiddleware(
        app,
        allow_origins=["https://allowed.example"],
        allow_methods=["GET", "POST"],
        cors_max_age=123,
    )

    messages = await run_request(
        middleware,
        origin="https://allowed.example",
        method="OPTIONS",
        extra_headers=[("access-control-request-method", "POST")],
    )
    headers = {name.lower(): value for name, value in messages[0]["headers"]}

    assert messages[0]["status"] == 200
    assert headers[b"Access-Control-Max-Age".lower()] == b"123"
    assert headers[b"Access-Control-Allow-Origin".lower()] == b"https://allowed.example"


@pytest.mark.anyio
async def test_preflight_denied_origin_has_no_allow_origin_header():
    middleware = DynamicCORSMiddleware(
        app,
        allow_origin_func=lambda origin: False,
        allow_methods=["POST"],
    )

    messages = await run_request(
        middleware,
        origin="https://blocked.example",
        method="OPTIONS",
        extra_headers=[("access-control-request-method", "POST")],
    )
    headers = {name.lower(): value for name, value in messages[0]["headers"]}

    assert messages[0]["status"] == 400
    assert b"access-control-allow-origin" not in headers


@pytest.mark.anyio
async def test_preflight_sets_credentials_when_enabled():
    middleware = DynamicCORSMiddleware(
        app,
        allow_origin_func=lambda origin: True,
        allow_credentials=True,
    )

    messages = await run_request(
        middleware,
        origin="https://allowed.example",
        method="OPTIONS",
        extra_headers=[("access-control-request-method", "GET")],
    )
    headers = {name.lower(): value for name, value in messages[0]["headers"]}

    assert headers[b"access-control-allow-credentials"] == b"true"


def test_existing_cors_middleware_export_is_unchanged():
    assert CORSMiddleware is StarletteCORSMiddleware
