import logging
import uuid

import anyio
import httpx
import pytest
from fastapi import FastAPI, Request
from fastapi.logger import get_request_id, logger
from fastapi.middleware.request_id import RequestIDMiddleware
from fastapi.testclient import TestClient


def make_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/request-id")
    async def read_request_id(request: Request) -> dict[str, str | None]:
        logger.info("request handler log")
        return {
            "state_request_id": request.state.request_id,
            "context_request_id": get_request_id(),
        }

    return app


def test_generates_unique_request_id_header_and_state() -> None:
    client = TestClient(make_app())

    first = client.get("/request-id")
    second = client.get("/request-id")

    first_id = first.headers["X-Request-ID"]
    second_id = second.headers["X-Request-ID"]
    uuid.UUID(first_id)
    uuid.UUID(second_id)
    assert first_id != second_id
    assert first.json() == {
        "state_request_id": first_id,
        "context_request_id": first_id,
    }
    assert second.json() == {
        "state_request_id": second_id,
        "context_request_id": second_id,
    }


def test_preserves_client_supplied_request_id() -> None:
    client = TestClient(make_app())

    response = client.get("/request-id", headers={"X-Request-ID": "client-request-1"})

    assert response.headers["X-Request-ID"] == "client-request-1"
    assert response.json() == {
        "state_request_id": "client-request-1",
        "context_request_id": "client-request-1",
    }


def test_logger_records_include_request_id(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO, logger="fastapi")
    client = TestClient(make_app())

    client.get("/request-id", headers={"X-Request-ID": "log-request-1"})

    records = [record for record in caplog.records if record.message == "request handler log"]
    assert records
    assert records[-1].request_id == "log-request-1"


def test_logger_still_works_without_middleware(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO, logger="fastapi")

    logger.info("outside request")

    records = [record for record in caplog.records if record.message == "outside request"]
    assert records
    assert records[-1].request_id == ""


@pytest.mark.anyio
async def test_concurrent_request_ids_do_not_leak() -> None:
    app = make_app()
    results: dict[str, httpx.Response] = {}

    async def fetch(client: httpx.AsyncClient, request_id: str) -> None:
        response = await client.get(
            "/request-id", headers={"X-Request-ID": request_id}
        )
        results[request_id] = response

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        async with anyio.create_task_group() as task_group:
            for request_id in ("concurrent-a", "concurrent-b", "concurrent-c"):
                task_group.start_soon(fetch, client, request_id)

    for request_id, response in results.items():
        assert response.headers["X-Request-ID"] == request_id
        assert response.json() == {
            "state_request_id": request_id,
            "context_request_id": request_id,
        }
