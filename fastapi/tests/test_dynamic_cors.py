import asyncio

from fastapi.middleware.cors import DynamicCORSMiddleware
from starlette.types import Message, Receive, Scope, Send


async def app(scope: Scope, receive: Receive, send: Send) -> None:
    await send(
        {
            "type": "http.response.start",
            "status": 200,
            "headers": [(b"content-type", b"text/plain")],
        }
    )
    await send({"type": "http.response.body", "body": b"Hello World"})


def request(
    middleware_options: dict[str, object],
    origin: str,
    method: str = "GET",
    request_method: str | None = None,
) -> tuple[int, dict[str, str]]:
    sent: list[Message] = []
    headers = [(b"origin", origin.encode())]
    if request_method is not None:
        headers.append((b"access-control-request-method", request_method.encode()))

    async def receive() -> Message:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message: Message) -> None:
        sent.append(message)

    async def run() -> None:
        middleware = DynamicCORSMiddleware(app, **middleware_options)
        scope: Scope = {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": method,
            "scheme": "http",
            "path": "/",
            "raw_path": b"/",
            "query_string": b"",
            "headers": headers,
            "client": ("testclient", 50000),
            "server": ("testserver", 80),
            "root_path": "",
        }
        await middleware(scope, receive, send)

    asyncio.run(run())
    response_start = sent[0]
    response_headers = {
        key.decode().lower(): value.decode()
        for key, value in response_start["headers"]
    }
    return response_start["status"], response_headers


def test_dynamic_allow() -> None:
    status_code, headers = request(
        {"allow_origin_func": lambda origin: origin == "https://allowed.com"},
        "https://allowed.com",
    )

    assert status_code == 200
    assert headers["access-control-allow-origin"] == "https://allowed.com"


def test_dynamic_deny() -> None:
    status_code, headers = request(
        {"allow_origin_func": lambda origin: origin == "https://allowed.com"},
        "https://denied.com",
    )

    assert status_code == 200
    assert "access-control-allow-origin" not in headers


def test_async_callback() -> None:
    async def allow_origin(origin: str) -> bool:
        return origin == "https://async-allowed.com"

    status_code, headers = request(
        {"allow_origin_func": allow_origin},
        "https://async-allowed.com",
    )

    assert status_code == 200
    assert headers["access-control-allow-origin"] == "https://async-allowed.com"


def test_fallback_to_static_allow_origins() -> None:
    status_code, headers = request(
        {"allow_origins": ["https://static-allowed.com"]},
        "https://static-allowed.com",
    )

    assert status_code == 200
    assert headers["access-control-allow-origin"] == "https://static-allowed.com"


def test_preflight_sets_access_control_max_age() -> None:
    def callback(origin: str) -> bool:
        return origin == "https://allowed.com"

    status_code, headers = request(
        {"allow_origin_func": callback, "cors_max_age": 3600},
        "https://allowed.com",
        method="OPTIONS",
        request_method="GET",
    )

    assert status_code == 200
    assert headers["access-control-max-age"] == "3600"
    assert headers["access-control-allow-origin"] == "https://allowed.com"
