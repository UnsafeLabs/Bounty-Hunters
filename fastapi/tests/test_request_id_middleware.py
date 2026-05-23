import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.logger import logger
from fastapi.middleware.request_id import RequestIDMiddleware
from fastapi.testclient import TestClient


def create_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/")
    def read_root(request: Request):
        logger.info("handling request")
        return {"request_id": request.state.request_id}

    return app


def test_request_id_middleware_generates_uuid_header_and_state(caplog):
    app = create_app()
    client = TestClient(app)
    caplog.set_level(logging.INFO, logger="fastapi")

    response = client.get("/")

    request_id = response.headers["x-request-id"]
    uuid.UUID(request_id)
    assert response.json() == {"request_id": request_id}
    assert any(record.request_id == request_id for record in caplog.records)


def test_request_id_middleware_preserves_client_header(caplog):
    app = create_app()
    client = TestClient(app)
    caplog.set_level(logging.INFO, logger="fastapi")

    response = client.get("/", headers={"X-Request-ID": "client-request-id"})

    assert response.headers["x-request-id"] == "client-request-id"
    assert response.json() == {"request_id": "client-request-id"}
    assert any(record.request_id == "client-request-id" for record in caplog.records)


def test_request_id_middleware_does_not_reuse_generated_ids():
    client = TestClient(create_app())

    first = client.get("/").headers["x-request-id"]
    second = client.get("/").headers["x-request-id"]

    assert first != second


def test_fastapi_logger_works_without_request_id_context(caplog):
    caplog.set_level(logging.INFO, logger="fastapi")

    logger.info("outside request")

    assert caplog.records[-1].request_id is None
