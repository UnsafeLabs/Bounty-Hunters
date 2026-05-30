import time

from fastapi import Depends, FastAPI, Security
from fastapi.security import APIKeyWithRateLimit
from fastapi.testclient import TestClient
from pydantic import BaseModel


def _make_app(rate_limit: str, deprecated_keys: set[str] | None = None):
    app = FastAPI()

    scheme = APIKeyWithRateLimit(
        name="x-api-key",
        rate_limit=rate_limit,
        deprecated_keys=deprecated_keys,
    )

    class User(BaseModel):
        username: str

    def get_current_user(oauth_header: str = Security(scheme)):
        user = User(username=oauth_header)
        return user

    @app.get("/users/me")
    def read_current_user(current_user: User = Depends(get_current_user)):
        return current_user

    @app.get("/users/me/response")
    def read_current_user_with_warning(
        current_user: User = Depends(get_current_user),
    ):
        from starlette.responses import JSONResponse

        data = current_user.model_dump()
        headers = {}
        warning = getattr(
            current_user.__dict__,
            "_deprecated_key_warning",
            None,
        )
        if not warning:
            try:
                warning = (
                    Security.__wrapped__
                    if hasattr(Security, "__wrapped__")
                    else None
                )
            except Exception:
                pass
        return JSONResponse(content=data, headers=headers)

    return app, scheme


def test_rate_limit_enforced():
    app, _ = _make_app(rate_limit="3/minute")
    client = TestClient(app)

    for i in range(3):
        response = client.get("/users/me", headers={"x-api-key": "secret"})
        assert response.status_code == 200, f"Request {i + 1} should succeed"

    response = client.get("/users/me", headers={"x-api-key": "secret"})
    assert response.status_code == 429, response.text
    assert response.json() == {"detail": "Rate limit exceeded"}
    assert "Retry-After" in response.headers
    retry_after = int(response.headers["Retry-After"])
    assert retry_after >= 1


def test_rate_limit_per_key_independent():
    app, _ = _make_app(rate_limit="2/minute")
    client = TestClient(app)

    for key in ("key-a", "key-b"):
        for i in range(2):
            response = client.get("/users/me", headers={"x-api-key": key})
            assert response.status_code == 200, f"Key {key} request {i + 1}"

    response = client.get("/users/me", headers={"x-api-key": "key-a"})
    assert response.status_code == 429

    response = client.get("/users/me", headers={"x-api-key": "key-b"})
    assert response.status_code == 429


def test_rate_limit_window_reset():
    app, _ = _make_app(rate_limit="2/second")
    client = TestClient(app)

    for i in range(2):
        response = client.get("/users/me", headers={"x-api-key": "secret"})
        assert response.status_code == 200

    response = client.get("/users/me", headers={"x-api-key": "secret"})
    assert response.status_code == 429

    time.sleep(1.1)

    response = client.get("/users/me", headers={"x-api-key": "secret"})
    assert response.status_code == 200


def test_no_rate_limit_when_none():
    app, _ = _make_app(rate_limit=None)
    client = TestClient(app)

    for i in range(20):
        response = client.get("/users/me", headers={"x-api-key": "secret"})
        assert response.status_code == 200, f"Request {i + 1}"


def test_deprecated_key_warning():
    app, _ = _make_app(
        rate_limit="10/minute",
        deprecated_keys={"old-key"},
    )
    client = TestClient(app)

    from starlette.middleware.base import BaseHTTPMiddleware

    class WarningHeaderMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            response = await call_next(request)
            warning = getattr(
                request.state, "_deprecated_key_warning", None
            )
            if warning:
                response.headers["Warning"] = warning
            return response

    app.add_middleware(WarningHeaderMiddleware)

    response = client.get("/users/me", headers={"x-api-key": "old-key"})
    assert response.status_code == 200
    assert "Warning" in response.headers
    assert "deprecated" in response.headers["Warning"].lower()
    assert "old-" in response.headers["Warning"]
    assert "-key" in response.headers["Warning"]


def test_non_deprecated_key_no_warning():
    app, _ = _make_app(
        rate_limit="10/minute",
        deprecated_keys={"old-key"},
    )
    client = TestClient(app)

    class WarningHeaderMiddleware:
        def __init__(self, app):
            self.app = app

        async def __call__(self, scope, receive, send):
            if scope["type"] != "http":
                await self.app(scope, receive, send)
                return

            from starlette.responses import Response

            sent_warning = False
            original_send = send

            async def custom_send(message):
                nonlocal sent_warning
                if message["type"] == "http.response.start" and not sent_warning:
                    headers = dict(
                        message.get("headers", [])
                    )
                    if b"warning" in headers:
                        sent_warning = True
                await original_send(message)

            await self.app(scope, receive, custom_send)

    response = client.get("/users/me", headers={"x-api-key": "new-key"})
    assert response.status_code == 200
    assert "Warning" not in response.headers


def test_missing_key_returns_401():
    app, _ = _make_app(rate_limit="10/minute")
    client = TestClient(app)

    response = client.get("/users/me")
    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated"}


def test_missing_key_auto_error_false():
    app = FastAPI()
    scheme = APIKeyWithRateLimit(
        name="x-api-key",
        rate_limit="10/minute",
        auto_error=False,
    )

    @app.get("/users/me")
    def read_current_user(key: str | None = Security(scheme)):
        return {"key": key}

    client = TestClient(app)
    response = client.get("/users/me")
    assert response.status_code == 200
    assert response.json() == {"key": None}


def test_invalid_rate_limit_format():
    try:
        APIKeyWithRateLimit(name="x-api-key", rate_limit="bad-format")
        assert False, "Should have raised ValueError"
    except ValueError as exc:
        assert "Invalid rate_limit format" in str(exc)


def test_rate_limit_hour_period():
    app, _ = _make_app(rate_limit="5/hour")
    client = TestClient(app)

    for i in range(5):
        response = client.get("/users/me", headers={"x-api-key": "secret"})
        assert response.status_code == 200

    response = client.get("/users/me", headers={"x-api-key": "secret"})
    assert response.status_code == 429


def test_rate_limit_day_period():
    scheme = APIKeyWithRateLimit(name="x-api-key", rate_limit="10/day")
    assert scheme._max_requests == 10
    assert scheme._window_seconds == 86400.0


def test_openapi_schema():
    app, _ = _make_app(rate_limit="10/minute")
    client = TestClient(app)

    response = client.get("/openapi.json")
    assert response.status_code == 200
    schema = response.json()
    assert "APIKeyWithRateLimit" in schema.get("components", {}).get(
        "securitySchemes", {}
    )
    security_scheme = schema["components"]["securitySchemes"][
        "APIKeyWithRateLimit"
    ]
    assert security_scheme["type"] == "apiKey"
    assert security_scheme["name"] == "x-api-key"
    assert security_scheme["in"] == "header"
