from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel


class Payload(BaseModel):
    username: str
    count: int
    profile: dict[str, Any]


def create_app(*, debug: bool = False) -> FastAPI:
    app = FastAPI(debug=debug)

    @app.post("/submit")
    def submit(payload: Payload):
        return payload  # pragma: no cover

    return app


def test_validation_error_includes_request_path_and_method_without_body_by_default():
    client = TestClient(create_app())

    response = client.post(
        "/submit",
        json={
            "username": "dom",
            "count": "not-an-int",
            "password": "plain-text",
            "profile": {"token": "nested-token"},
        },
    )

    assert response.status_code == 422
    data = response.json()
    assert data["path"] == "/submit"
    assert data["method"] == "POST"
    assert "detail" in data
    assert "body" not in data


def test_debug_validation_error_includes_redacted_request_body():
    client = TestClient(create_app(debug=True))

    response = client.post(
        "/submit",
        json={
            "username": "dom",
            "count": "not-an-int",
            "password": "plain-text",
            "profile": {
                "api_key": "api-key",
                "nested": [
                    {"secret": "nested-secret"},
                    {"token": "nested-token", "safe": "visible"},
                ],
            },
        },
    )

    assert response.status_code == 422
    data = response.json()
    assert data["path"] == "/submit"
    assert data["method"] == "POST"
    assert data["body"] == {
        "username": "dom",
        "count": "not-an-int",
        "password": "***REDACTED***",
        "profile": {
            "api_key": "***REDACTED***",
            "nested": [
                {"secret": "***REDACTED***"},
                {"token": "***REDACTED***", "safe": "visible"},
            ],
        },
    }
