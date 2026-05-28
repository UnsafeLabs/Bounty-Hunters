"""Tests for request validation exception handler with request context and body redaction."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def debug_app():
    """FastAPI app in debug mode."""
    app = FastAPI(debug=True)

    @app.post("/items")
    async def create_item(name: str, price: float):
        return {"name": name, "price": price}

    return app


@pytest.fixture
def prod_app():
    """FastAPI app in production mode (debug=False)."""
    app = FastAPI(debug=False)

    @app.post("/items")
    async def create_item(name: str, price: float):
        return {"name": name, "price": price}

    return app


@pytest.fixture
def password_app():
    """FastAPI app with password field."""
    app = FastAPI(debug=True)

    @app.post("/register")
    async def register(username: str, password: str, token: str = "default"):
        return {"username": username}

    return app


@pytest.fixture
def nested_app():
    """FastAPI app with nested body."""
    app = FastAPI(debug=True)

    @app.post("/nested")
    async def nested_endpoint(data: dict):
        return {"ok": True}

    return app


class TestRequestContextInErrors:
    """Test that validation errors include request path and method."""

    def test_error_includes_path(self, prod_app):
        client = TestClient(prod_app, raise_server_exceptions=False)
        response = client.post("/items")
        assert response.status_code == 422
        body = response.json()
        assert "path" in body
        assert body["path"] == "/items"

    def test_error_includes_method(self, prod_app):
        client = TestClient(prod_app, raise_server_exceptions=False)
        response = client.post("/items")
        assert response.status_code == 422
        body = response.json()
        assert "method" in body
        assert body["method"] == "POST"

    def test_error_includes_detail(self, prod_app):
        client = TestClient(prod_app, raise_server_exceptions=False)
        response = client.post("/items")
        assert response.status_code == 422
        body = response.json()
        assert "detail" in body
        assert isinstance(body["detail"], list)


class TestDebugModeBody:
    """Test that debug mode includes the request body."""

    def test_debug_includes_body(self, debug_app):
        client = TestClient(debug_app, raise_server_exceptions=False)
        response = client.post(
            "/items",
            json={"name": "widget"},
            # Missing price to trigger validation error
        )
        assert response.status_code == 422
        body = response.json()
        assert "body" in body
        assert isinstance(body["body"], dict)

    def test_prod_excludes_body(self, prod_app):
        client = TestClient(prod_app, raise_server_exceptions=False)
        response = client.post("/items", json={"name": "widget"})
        assert response.status_code == 422
        body = response.json()
        assert "body" not in body


class TestRedaction:
    """Test that sensitive fields are redacted."""

    def test_password_redacted(self, password_app):
        client = TestClient(password_app, raise_server_exceptions=False)
        response = client.post(
            "/register",
            json={"username": "alice", "password": "secret123", "token": "abc123"},
        )
        # This might succeed or fail depending on validation; force a validation error
        # by sending invalid data
        response = client.post(
            "/register",
            json={"password": "secret123", "token": "abc123"},
            # Missing username
        )
        assert response.status_code == 422
        body = response.json()
        if "body" in body:
            assert body["body"].get("password") == "***REDACTED***"
            assert body["body"].get("token") == "***REDACTED***"

    def test_nested_redaction(self):
        """Sensitive fields in nested objects are redacted."""
        from fastapi.exception_handlers import _redact_sensitive_fields

        data = {
            "user": {
                "name": "alice",
                "password": "secret",
                "settings": {
                    "api_key": "key123",
                    "theme": "dark",
                },
            },
            "token": "mytoken",
        }
        result = _redact_sensitive_fields(data)
        assert result["user"]["name"] == "alice"
        assert result["user"]["password"] == "***REDACTED***"
        assert result["user"]["settings"]["api_key"] == "***REDACTED***"
        assert result["user"]["settings"]["theme"] == "dark"
        assert result["token"] == "***REDACTED***"

    def test_redaction_case_insensitive(self):
        """Redaction is case-insensitive."""
        from fastapi.exception_handlers import _redact_sensitive_fields

        data = {"Password": "secret", "API_KEY": "key", "TOKEN": "tok"}
        result = _redact_sensitive_fields(data)
        assert result["Password"] == "***REDACTED***"
        assert result["API_KEY"] == "***REDACTED***"
        assert result["TOKEN"] == "***REDACTED***"

    def test_redaction_in_list(self):
        """Redaction works in lists of dicts."""
        from fastapi.exception_handlers import _redact_sensitive_fields

        data = [
            {"username": "alice", "password": "secret1"},
            {"username": "bob", "password": "secret2"},
        ]
        result = _redact_sensitive_fields(data)
        assert result[0]["password"] == "***REDACTED***"
        assert result[1]["password"] == "***REDACTED***"
        assert result[0]["username"] == "alice"

    def test_non_dict_passthrough(self):
        """Non-dict values pass through unchanged."""
        from fastapi.exception_handlers import _redact_sensitive_fields

        assert _redact_sensitive_fields("hello") == "hello"
        assert _redact_sensitive_fields(42) == 42
        assert _redact_sensitive_fields(None) is None
