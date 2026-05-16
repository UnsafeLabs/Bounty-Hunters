import asyncio
import logging
from uuid import UUID

import httpx
import pytest
from fastapi import FastAPI, Request
from fastapi.logger import get_request_id, logger
from fastapi.middleware.request_id import RequestIDMiddleware
from fastapi.testclient import TestClient


def test_request_id_middleware_generates_uuid_header() -> None:
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/")
    def read_root(request: Request) -> dict[str, str | None]:
        return {
            "context_request_id": get_request_id(),
            "state_request_id": request.state.request_id,
        }

    response = TestClient(app).get("/")

    request_id = response.headers["x-request-id"]
    UUID(request_id)
    assert response.json() == {
        "context_request_id": request_id,
        "state_request_id": request_id,
    }


def test_request_id_middleware_preserves_client_header() -> None:
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/")
    def read_root(request: Request) -> dict[str, str]:
        return {"request_id": request.state.request_id}

    response = TestClient(app).get("/", headers={"X-Request-ID": "client-request-1"})

    assert response.headers["x-request-id"] == "client-request-1"
    assert response.json() == {"request_id": "client-request-1"}


def test_request_id_is_available_on_log_records(
    caplog: pytest.LogCaptureFixture,
) -> None:
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/")
    def read_root() -> dict[str, str]:
        logger.info("handling request")
        return {"request_id": get_request_id() or ""}

    caplog.set_level(logging.INFO, logger="fastapi")
    response = TestClient(app).get("/", headers={"X-Request-ID": "log-request-1"})

    assert response.json() == {"request_id": "log-request-1"}
    records = [
        record for record in caplog.records if record.message == "handling request"
    ]
    assert records
    assert records[-1].request_id == "log-request-1"


def test_request_ids_do_not_leak_between_concurrent_requests(
    caplog: pytest.LogCaptureFixture,
) -> None:
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/")
    async def read_root(request: Request) -> dict[str, str]:
        await asyncio.sleep(0.01)
        logger.info("handling concurrent request")
        return {
            "context_request_id": get_request_id() or "",
            "state_request_id": request.state.request_id,
        }

    caplog.set_level(logging.INFO, logger="fastapi")

    async def run_requests() -> tuple[httpx.Response, httpx.Response]:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as client:
            return await asyncio.gather(
                client.get("/", headers={"X-Request-ID": "concurrent-1"}),
                client.get("/", headers={"X-Request-ID": "concurrent-2"}),
            )

    first, second = asyncio.run(run_requests())

    assert first.headers["x-request-id"] == "concurrent-1"
    assert first.json() == {
        "context_request_id": "concurrent-1",
        "state_request_id": "concurrent-1",
    }
    assert second.headers["x-request-id"] == "concurrent-2"
    assert second.json() == {
        "context_request_id": "concurrent-2",
        "state_request_id": "concurrent-2",
    }
    assert {
        record.request_id
        for record in caplog.records
        if record.message == "handling concurrent request"
    } == {"concurrent-1", "concurrent-2"}


def test_logger_has_default_request_id_without_middleware(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO, logger="fastapi")

    logger.info("outside request")

    records = [
        record for record in caplog.records if record.message == "outside request"
    ]
    assert records
    assert records[-1].request_id == "-"
