import logging
import re

from fastapi import FastAPI, Request
from fastapi.logger import logger
from fastapi.middleware.request_id import RequestIDMiddleware, request_id_context
from fastapi.testclient import TestClient


def test_request_id_middleware_generates_and_exposes_request_id() -> None:
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/")
    def read_root(request: Request) -> dict[str, str]:
        return {"request_id": request.state.request_id}

    client = TestClient(app)
    response = client.get("/")

    request_id = response.headers["x-request-id"]
    assert re.fullmatch(
        r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
        request_id,
    )
    assert response.json() == {"request_id": request_id}
    assert request_id_context.get() is None


def test_request_id_middleware_preserves_client_request_id() -> None:
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/")
    def read_root(request: Request) -> dict[str, str]:
        return {"request_id": request.state.request_id}

    client = TestClient(app)
    response = client.get("/", headers={"X-Request-ID": "client-id-123"})

    assert response.headers["x-request-id"] == "client-id-123"
    assert response.json() == {"request_id": "client-id-123"}
    assert request_id_context.get() is None


def test_fastapi_logger_adds_request_id_to_log_records(caplog) -> None:  # type: ignore[no-untyped-def]
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/")
    def read_root() -> dict[str, str]:
        logger.warning("request scoped log")
        return {"ok": "true"}

    client = TestClient(app)

    with caplog.at_level(logging.WARNING, logger="fastapi"):
        response = client.get("/", headers={"X-Request-ID": "log-id-123"})

    assert response.headers["x-request-id"] == "log-id-123"
    matching_records = [
        record for record in caplog.records if record.message == "request scoped log"
    ]
    assert matching_records
    assert matching_records[0].request_id == "log-id-123"
    assert request_id_context.get() is None
