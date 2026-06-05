import logging
from uuid import UUID

import anyio
import httpx
import pytest
from fastapi import FastAPI, Request
from fastapi.logger import logger
from fastapi.middleware.request_id import RequestIDMiddleware
from fastapi.testclient import TestClient


def create_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/request-id")
    async def read_request_id(request: Request) -> dict[str, str]:
        logger.info("handling request")
        return {"request_id": request.state.request_id}

    @app.get("/slow-request-id")
    async def read_slow_request_id(request: Request) -> dict[str, str]:
        await anyio.sleep(0.01)
        logger.info("handling slow request")
        return {"request_id": request.state.request_id}

    return app


def test_generates_uuid_request_id() -> None:
    client = TestClient(create_app())
    response = client.get("/request-id")

    assert response.status_code == 200
    request_id = response.headers["X-Request-ID"]
    UUID(request_id)
    assert response.json() == {"request_id": request_id}


def test_preserves_client_request_id() -> None:
    client = TestClient(create_app())
    response = client.get("/request-id", headers={"X-Request-ID": "client-id-123"})

    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == "client-id-123"
    assert response.json() == {"request_id": "client-id-123"}


def test_log_record_includes_request_id(caplog: pytest.LogCaptureFixture) -> None:
    client = TestClient(create_app())

    with caplog.at_level(logging.INFO, logger="fastapi"):
        response = client.get("/request-id", headers={"X-Request-ID": "log-id-123"})

    assert response.status_code == 200
    records = [record for record in caplog.records if record.name == "fastapi"]
    assert records
    assert records[-1].request_id == "log-id-123"


def test_logger_has_default_request_id_without_middleware(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.INFO, logger="fastapi"):
        logger.info("outside middleware")

    records = [record for record in caplog.records if record.name == "fastapi"]
    assert records
    assert records[-1].request_id == "-"


@pytest.mark.anyio
async def test_request_ids_do_not_leak_between_concurrent_requests() -> None:
    transport = httpx.ASGITransport(app=create_app())
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        responses: dict[str, httpx.Response] = {}

        async def fetch(name: str, request_id: str) -> None:
            responses[name] = await client.get(
                "/slow-request-id", headers={"X-Request-ID": request_id}
            )

        async with anyio.create_task_group() as task_group:
            task_group.start_soon(fetch, "first", "first-id")
            task_group.start_soon(fetch, "second", "second-id")

    first = responses["first"]
    second = responses["second"]

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.headers["X-Request-ID"] == "first-id"
    assert second.headers["X-Request-ID"] == "second-id"
    assert first.json() == {"request_id": "first-id"}
    assert second.json() == {"request_id": "second-id"}
