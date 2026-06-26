import asyncio
import logging
from collections.abc import Iterator
from contextlib import contextmanager
from uuid import UUID

import httpx
from fastapi import FastAPI, Request
from fastapi.logger import logger
from fastapi.middleware.request_id import (
    REQUEST_ID_HEADER,
    RequestIDMiddleware,
    get_request_id,
)
from fastapi.testclient import TestClient


class CapturingHandler(logging.Handler):
    def __init__(self) -> None:
        super().__init__()
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)


@contextmanager
def capture_fastapi_logs() -> Iterator[list[logging.LogRecord]]:
    handler = CapturingHandler()
    original_level = logger.level
    logger.setLevel(logging.INFO)
    logger.addHandler(handler)
    try:
        yield handler.records
    finally:
        logger.removeHandler(handler)
        logger.setLevel(original_level)


def build_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/request-id")
    def read_request_id(request: Request):
        return {
            "state": request.state.request_id,
            "context": get_request_id(),
        }

    return app


def test_request_id_middleware_generates_uuid_and_sets_state():
    client = TestClient(build_app())

    response = client.get("/request-id")

    request_id = response.headers[REQUEST_ID_HEADER]
    UUID(request_id)
    assert response.json() == {
        "state": request_id,
        "context": request_id,
    }
    assert get_request_id() is None


def test_request_id_middleware_preserves_client_header():
    client = TestClient(build_app())

    response = client.get(
        "/request-id", headers={REQUEST_ID_HEADER: "client-request-id"}
    )

    assert response.headers[REQUEST_ID_HEADER] == "client-request-id"
    assert response.json() == {
        "state": "client-request-id",
        "context": "client-request-id",
    }


def test_log_records_include_request_id_during_request():
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/logged")
    def logged_endpoint(request: Request):
        logger.info("request handled")
        return {"request_id": request.state.request_id}

    client = TestClient(app)

    with capture_fastapi_logs() as records:
        response = client.get("/logged", headers={REQUEST_ID_HEADER: "logged-request"})

    assert response.headers[REQUEST_ID_HEADER] == "logged-request"
    assert response.json() == {"request_id": "logged-request"}
    assert [record.request_id for record in records] == ["logged-request"]
    assert get_request_id() is None


def test_logger_works_without_request_id_middleware():
    with capture_fastapi_logs() as records:
        logger.info("outside a request")

    assert [record.request_id for record in records] == ["-"]


def test_request_ids_do_not_leak_between_concurrent_requests():
    async def run_requests() -> tuple[httpx.Response, httpx.Response]:
        app = FastAPI()
        app.add_middleware(RequestIDMiddleware)
        reached_endpoint: list[str] = []
        release = asyncio.Event()

        @app.get("/wait")
        async def wait_endpoint(request: Request):
            reached_endpoint.append(request.state.request_id)
            if len(reached_endpoint) == 2:
                release.set()
            await asyncio.wait_for(release.wait(), timeout=1)
            logger.info("concurrent request")
            return {
                "state": request.state.request_id,
                "context": get_request_id(),
            }

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as client:
            return await asyncio.gather(
                client.get("/wait", headers={REQUEST_ID_HEADER: "first"}),
                client.get("/wait", headers={REQUEST_ID_HEADER: "second"}),
            )

    with capture_fastapi_logs() as records:
        first_response, second_response = asyncio.run(run_requests())

    assert first_response.json() == {"state": "first", "context": "first"}
    assert second_response.json() == {"state": "second", "context": "second"}
    assert first_response.headers[REQUEST_ID_HEADER] == "first"
    assert second_response.headers[REQUEST_ID_HEADER] == "second"
    assert sorted(record.request_id for record in records) == ["first", "second"]
    assert get_request_id() is None
