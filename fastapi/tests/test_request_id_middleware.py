import asyncio
import logging
from uuid import UUID

import anyio
import httpx
import pytest
from fastapi import FastAPI, Request
from fastapi.logger import logger
from fastapi.middleware.request_id import RequestIDMiddleware, get_request_id
from fastapi.testclient import TestClient


class FormattedLogHandler(logging.Handler):
    def __init__(self) -> None:
        super().__init__()
        self.messages: list[str] = []
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)
        self.messages.append(self.format(record))


def create_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/")
    async def read_request_id(request: Request):
        logger.info("handling request")
        return {
            "state_request_id": request.state.request_id,
            "context_request_id": get_request_id(),
        }

    return app


def test_generates_unique_request_ids() -> None:
    client = TestClient(create_app())

    first_response = client.get("/")
    second_response = client.get("/")

    first_request_id = first_response.headers["X-Request-ID"]
    second_request_id = second_response.headers["X-Request-ID"]

    UUID(first_request_id)
    UUID(second_request_id)
    assert first_request_id != second_request_id
    assert first_response.json() == {
        "state_request_id": first_request_id,
        "context_request_id": first_request_id,
    }
    assert second_response.json() == {
        "state_request_id": second_request_id,
        "context_request_id": second_request_id,
    }


def test_preserves_client_provided_request_id() -> None:
    client = TestClient(create_app())

    response = client.get("/", headers={"X-Request-ID": "client-request-id"})

    assert response.headers["X-Request-ID"] == "client-request-id"
    assert response.json() == {
        "state_request_id": "client-request-id",
        "context_request_id": "client-request-id",
    }


def test_logger_includes_request_id_during_request() -> None:
    client = TestClient(create_app())
    handler = FormattedLogHandler()
    handler.setFormatter(logging.Formatter("%(request_id)s:%(message)s"))
    original_level = logger.level
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)

    try:
        response = client.get("/", headers={"X-Request-ID": "logged-request-id"})
    finally:
        logger.removeHandler(handler)
        logger.setLevel(original_level)

    assert response.status_code == 200
    assert handler.records[-1].request_id == "logged-request-id"
    assert handler.messages[-1] == "logged-request-id:handling request"


def test_logger_works_without_request_id_middleware() -> None:
    app = FastAPI()

    @app.get("/")
    def read_root():
        logger.info("without middleware")
        return {"ok": True}

    client = TestClient(app)
    handler = FormattedLogHandler()
    handler.setFormatter(logging.Formatter("%(request_id)s:%(message)s"))
    original_level = logger.level
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)

    try:
        response = client.get("/")
    finally:
        logger.removeHandler(handler)
        logger.setLevel(original_level)

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert handler.messages[-1] == "-:without middleware"


@pytest.mark.anyio
async def test_request_ids_do_not_leak_between_concurrent_requests() -> None:
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/")
    async def read_request_id(request: Request):
        await anyio.sleep(0.01)
        return {
            "state_request_id": request.state.request_id,
            "context_request_id": get_request_id(),
        }

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as client:
        first_response, second_response = await asyncio.gather(
            client.get("/", headers={"X-Request-ID": "first-request"}),
            client.get("/", headers={"X-Request-ID": "second-request"}),
        )

    assert first_response.json() == {
        "state_request_id": "first-request",
        "context_request_id": "first-request",
    }
    assert second_response.json() == {
        "state_request_id": "second-request",
        "context_request_id": "second-request",
    }
