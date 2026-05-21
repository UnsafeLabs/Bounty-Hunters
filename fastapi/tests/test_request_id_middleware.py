import asyncio
import logging
import uuid

import httpx

from fastapi import FastAPI, Request
from fastapi.logger import get_request_id, logger
from fastapi.middleware.request_id import RequestIDMiddleware
from fastapi.testclient import TestClient


def create_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/")
    async def read_root(request: Request):
        logger.info("handling request")
        return {"request_id": request.state.request_id}

    @app.get("/slow")
    async def read_slow(request: Request):
        await asyncio.sleep(0.01)
        logger.info("handling slow request")
        return {"request_id": request.state.request_id}

    return app


def test_request_id_middleware_generates_uuid_and_adds_log_context(caplog):
    caplog.set_level(logging.INFO, logger="fastapi")
    client = TestClient(create_app())

    response = client.get("/")

    request_id = response.headers["x-request-id"]
    assert response.json() == {"request_id": request_id}
    assert uuid.UUID(request_id).version == 4
    assert get_request_id() is None

    log_record = next(record for record in caplog.records if record.name == "fastapi")
    assert log_record.request_id == request_id


def test_request_id_middleware_preserves_client_request_id():
    client = TestClient(create_app())

    response = client.get("/", headers={"X-Request-ID": "client-request-123"})

    assert response.headers["x-request-id"] == "client-request-123"
    assert response.json() == {"request_id": "client-request-123"}
    assert get_request_id() is None


def test_request_id_middleware_does_not_leak_between_concurrent_requests():
    async def run_requests():
        transport = httpx.ASGITransport(app=create_app())
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as client:
            first, second = await asyncio.gather(
                client.get("/slow", headers={"X-Request-ID": "request-one"}),
                client.get("/slow", headers={"X-Request-ID": "request-two"}),
            )
            return first, second

    first, second = asyncio.run(run_requests())

    assert first.headers["x-request-id"] == "request-one"
    assert first.json() == {"request_id": "request-one"}
    assert second.headers["x-request-id"] == "request-two"
    assert second.json() == {"request_id": "request-two"}
    assert get_request_id() is None


def test_logger_keeps_working_without_request_id_middleware(caplog):
    app = FastAPI()

    @app.get("/")
    async def read_root():
        logger.info("handling request without middleware")
        return {"request_id": get_request_id()}

    caplog.set_level(logging.INFO, logger="fastapi")
    response = TestClient(app).get("/")

    assert "x-request-id" not in response.headers
    assert response.json() == {"request_id": None}
    log_record = next(record for record in caplog.records if record.name == "fastapi")
    assert log_record.request_id is None
