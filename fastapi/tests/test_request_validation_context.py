from fastapi import Body, FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel


class LoginPayload(BaseModel):
    username: str
    password: str
    age: int
    profile: dict
    sessions: list[dict]


def create_app(debug: bool) -> FastAPI:
    app = FastAPI(debug=debug)

    @app.post("/login/{tenant}")
    def login(tenant: str, payload: LoginPayload = Body()):
        return {"tenant": tenant, "username": payload.username}

    return app


def test_validation_error_includes_request_path_and_method():
    client = TestClient(create_app(debug=False))

    response = client.post("/login/acme", json={"username": "alice"})

    assert response.status_code == 422
    data = response.json()
    assert data["path"] == "/login/acme"
    assert data["method"] == "POST"
    assert "body" not in data


def test_debug_validation_error_includes_redacted_nested_body():
    client = TestClient(create_app(debug=True))

    response = client.post(
        "/login/acme",
        json={
            "username": "alice",
            "password": "plain-text",
            "age": "not-an-int",
            "profile": {
                "secret": "inner-secret",
                "nested": {"token": "inner-token", "safe": "kept"},
            },
            "sessions": [
                {"api_key": "first-key", "label": "prod"},
                {"password": "second-password"},
            ],
        },
    )

    assert response.status_code == 422
    data = response.json()
    assert data["path"] == "/login/acme"
    assert data["method"] == "POST"
    assert data["body"] == {
        "username": "alice",
        "password": "***REDACTED***",
        "age": "not-an-int",
        "profile": {
            "secret": "***REDACTED***",
            "nested": {"token": "***REDACTED***", "safe": "kept"},
        },
        "sessions": [
            {"api_key": "***REDACTED***", "label": "prod"},
            {"password": "***REDACTED***"},
        ],
    }
