"""Tests for exception_handlers.py - validation error redaction."""

import pytest
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field
from starlette.requests import Request

from fastapi.exception_handlers import (
    _redact_sensitive_fields,
    _is_debug_mode,
    request_validation_exception_handler,
)


class TestRedactSensitiveFields:
    """Tests for the _redact_sensitive_fields function."""

    def test_redacts_top_level_sensitive_fields(self):
        """Top-level sensitive fields should be redacted."""
        body = {
            "username": "john",
            "password": "secret123",
            "email": "john@example.com",
        }
        result = _redact_sensitive_fields(body)
        assert result["username"] == "john"
        assert result["password"] == "***REDACTED***"
        assert result["email"] == "john@example.com"

    def test_redacts_nested_sensitive_fields(self):
        """Nested sensitive fields should be redacted."""
        body = {
            "user": {
                "name": "john",
                "credentials": {
                    "password": "secret123",
                    "api_key": "sk-123456",
                },
            },
            "settings": {
                "theme": "dark",
            },
        }
        result = _redact_sensitive_fields(body)
        assert result["user"]["name"] == "john"
        assert result["user"]["credentials"]["password"] == "***REDACTED***"
        assert result["user"]["credentials"]["api_key"] == "***REDACTED***"
        assert result["settings"]["theme"] == "dark"

    def test_redacts_sensitive_fields_in_lists(self):
        """Sensitive fields in list items should be redacted."""
        body = {
            "users": [
                {"name": "alice", "password": "pass1"},
                {"name": "bob", "token": "tok-abc"},
            ],
        }
        result = _redact_sensitive_fields(body)
        assert result["users"][0]["name"] == "alice"
        assert result["users"][0]["password"] == "***REDACTED***"
        assert result["users"][1]["name"] == "bob"
        assert result["users"][1]["token"] == "***REDACTED***"

    def test_redacts_all_sensitive_field_variants(self):
        """All sensitive field name variants should be redacted."""
        body = {
            "password": "p1",
            "Password": "p2",
            "PASSWORD": "p3",
            "secret": "s1",
            "Secret": "s2",
            "token": "t1",
            "Token": "t2",
            "api_key": "a1",
            "Api_Key": "a2",
            "API_KEY": "a3",
        }
        result = _redact_sensitive_fields(body)
        for key in body:
            assert result[key] == "***REDACTED***"

    def test_non_dict_input_unchanged(self):
        """Non-dict input should be returned unchanged."""
        assert _redact_sensitive_fields("string") == "string"
        assert _redact_sensitive_fields(42) == 42
        assert _redact_sensitive_fields(None) is None

    def test_empty_dict_unchanged(self):
        """Empty dict should be returned unchanged."""
        assert _redact_sensitive_fields({}) == {}


class TestIsDebugMode:
    """Tests for the _is_debug_mode function."""

    def test_debug_false_by_default(self):
        """Debug mode should be False by default."""
        assert _is_debug_mode() is False

    def test_debug_true_from_app(self):
        """Debug mode should be True when app.debug is True."""
        app = FastAPI(debug=True)
        assert _is_debug_mode(app) is True

    def test_debug_false_from_app(self):
        """Debug mode should be False when app.debug is False."""
        app = FastAPI(debug=False)
        assert _is_debug_mode(app) is False


class TestRequestValidationExceptionHandler:
    """Tests for the request_validation_exception_handler."""

    def test_includes_path_and_method(self):
        """Handler should include request path and method."""
        app = FastAPI()

        class User(BaseModel):
            name: str = Field(..., min_length=2)
            email: str

        @app.post("/users")
        def create_user(user: User):
            return user

        client = TestClient(app)
        response = client.post("/users", json={"name": "a", "email": "invalid"})

        assert response.status_code == 422
        data = response.json()
        assert "request" in data
        assert data["request"]["path"] == "/users"
        assert data["request"]["method"] == "POST"

    def test_debug_mode_includes_body(self):
        """In debug mode, handler should include redacted body."""
        app = FastAPI(debug=True)

        class User(BaseModel):
            name: str
            password: str

        @app.post("/register")
        def register(user: User):
            return user

        client = TestClient(app)
        response = client.post("/register", json={
            "name": "john",
            "password": "secret123",
        })

        assert response.status_code == 422
        data = response.json()
        assert "body" in data
        assert data["body"]["password"] == "***REDACTED***"
        assert data["body"]["name"] == "john"

    def test_non_debug_mode_excludes_body(self):
        """In non-debug mode, handler should NOT include body."""
        app = FastAPI(debug=False)

        class User(BaseModel):
            name: str
            password: str

        @app.post("/register")
        def register(user: User):
            return user

        client = TestClient(app)
        response = client.post("/register", json={
            "name": "john",
            "password": "secret123",
        })

        assert response.status_code == 422
        data = response.json()
        assert "body" not in data

    def test_redacts_nested_sensitive_in_validation_error(self):
        """Nested sensitive fields in body should be redacted."""
        app = FastAPI(debug=True)

        class Credentials(BaseModel):
            password: str
            api_key: str

        class User(BaseModel):
            name: str
            creds: Credentials

        @app.post("/users")
        def create_user(user: User):
            return user

        client = TestClient(app)
        response = client.post("/users", json={
            "name": 123,  # Invalid type
            "creds": {
                "password": "secret",
                "api_key": "sk-123",
            },
        })

        data = response.json()
        assert "body" in data
        assert data["body"]["creds"]["password"] == "***REDACTED***"
        assert data["body"]["creds"]["api_key"] == "***REDACTED***"
