import logging
import uuid

import anyio
import httpx
import pytest
from fastapi import FastAPI, Request
from fastapi.logger import get_request_id, logger
from fastapi.middleware.requestid import RequestIDMiddleware
from fastapi.testclient import TestClient


def test_request_id_middleware_generates_uuid_and_exposes_state() -> None:
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/")
    def read_root(request: Request):
        return {
            "state_request_id": request.state.request_id,
            "context_request_id": get_request_id(),
        }

    client = TestClient(app)
    response = client.get("/")

    request_id = response.headers["x-request-id"]
    uuid.UUID(request_id)
    assert response.json() == {
        "state_request_id": request_id,
        "context_request_id": request_id,
    }


def test_request_id_middleware_preserves_client_header() -> None:
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/")
    def read_root(request: Request):
        return {"request_id": request.state.request_id}

    client = TestClient(app)
    response = client.get("/", headers={"X-Request-ID": "client-request-123"})

    assert response.headers["x-request-id"] == "client-request-123"
    assert response.json() == {"request_id": "client-request-123"}


def test_log_records_include_request_id(caplog: pytest.LogCaptureFixture) -> None:
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/")
    def read_root():
        logger.info("handled request")
        return {"request_id": get_request_id()}

    client = TestClient(app)
    with caplog.at_level(logging.INFO, logger="fastapi"):
        response = client.get("/", headers={"X-Request-ID": "log-request-123"})

    assert response.json() == {"request_id": "log-request-123"}
    assert any(
        record.message == "handled request"
        and record.request_id == "log-request-123"
        for record in caplog.records
    )


def test_logger_keeps_default_behavior_without_middleware(
    caplog: pytest.LogCaptureFixture,
) -> None:
    app = FastAPI()

    @app.get("/")
    def read_root():
        logger.info("handled request without middleware")
        return {"request_id": get_request_id()}

    client = TestClient(app)
    with caplog.at_level(logging.INFO, logger="fastapi"):
        response = client.get("/")

    assert response.json() == {"request_id": None}
    assert any(
        record.message == "handled request without middleware"
        and record.request_id == "-"
        for record in caplog.records
    )


@pytest.mark.anyio
async def test_request_ids_are_isolated_between_concurrent_requests() -> None:
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/")
    async def read_root(request: Request):
        before_sleep = get_request_id()
        await anyio.sleep(0.01)
        return {
            "state_request_id": request.state.request_id,
            "context_before_sleep": before_sleep,
            "context_after_sleep": get_request_id(),
        }

    responses: dict[str, httpx.Response] = {}

    async def fetch(client: httpx.AsyncClient, request_id: str) -> None:
        responses[request_id] = await client.get(
            "/", headers={"X-Request-ID": request_id}
        )

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as client:
        async with anyio.create_task_group() as task_group:
            task_group.start_soon(fetch, client, "first-request")
            task_group.start_soon(fetch, client, "second-request")

    for request_id, response in responses.items():
        assert response.headers["x-request-id"] == request_id
        assert response.json() == {
            "state_request_id": request_id,
            "context_before_sleep": request_id,
            "context_after_sleep": request_id,
        }


def test_request_id_context_is_reset_after_response() -> None:
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/")
    def read_root():
        return {"request_id": get_request_id()}

    client = TestClient(app)
    response = client.get("/", headers={"X-Request-ID": "scoped-request"})

    assert response.json() == {"request_id": "scoped-request"}
    assert get_request_id() is None
