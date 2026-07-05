import logging
import re
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from fastapi import FastAPI, Request
from fastapi.logger import get_request_id, logger
from fastapi.middleware.requestid import RequestIDMiddleware
from fastapi.testclient import TestClient

UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)


def make_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/request-id")
    async def read_request_id(request: Request):
        logger.info("request id seen")
        return {
            "request_id": request.state.request_id,
            "context_request_id": get_request_id(),
        }

    return app


def test_request_id_middleware_generates_uuid_header():
    client = TestClient(make_app())

    response = client.get("/request-id")

    assert response.status_code == 200
    request_id = response.headers["x-request-id"]
    assert UUID_RE.match(request_id)
    assert response.json() == {
        "request_id": request_id,
        "context_request_id": request_id,
    }


def test_request_id_middleware_preserves_client_header():
    client = TestClient(make_app())

    response = client.get("/request-id", headers={"X-Request-ID": "client-id-123"})

    assert response.status_code == 200
    assert response.headers["x-request-id"] == "client-id-123"
    assert response.json() == {
        "request_id": "client-id-123",
        "context_request_id": "client-id-123",
    }


def test_request_id_is_added_to_log_records(caplog):
    client = TestClient(make_app())

    with caplog.at_level(logging.INFO, logger="fastapi"):
        response = client.get("/request-id", headers={"X-Request-ID": "log-id"})

    assert response.status_code == 200
    matching_records = [
        record for record in caplog.records if record.message == "request id seen"
    ]
    assert matching_records
    assert matching_records[-1].request_id == "log-id"


def test_logger_keeps_default_behavior_without_middleware(caplog):
    app = FastAPI()

    @app.get("/plain")
    async def plain():
        logger.info("plain request")
        return {"context_request_id": get_request_id()}

    client = TestClient(app)

    with caplog.at_level(logging.INFO, logger="fastapi"):
        response = client.get("/plain")

    assert response.status_code == 200
    assert response.json() == {"context_request_id": None}
    matching_records = [
        record for record in caplog.records if record.message == "plain request"
    ]
    assert matching_records
    assert matching_records[-1].request_id == "-"


def test_request_ids_do_not_leak_between_concurrent_requests():
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)
    barrier = Barrier(2)

    @app.get("/parallel")
    async def parallel(request: Request):
        barrier.wait(timeout=2)
        return {
            "request_id": request.state.request_id,
            "context_request_id": get_request_id(),
        }

    client = TestClient(app)

    def get_with_request_id(request_id: str):
        response = client.get("/parallel", headers={"X-Request-ID": request_id})
        assert response.status_code == 200
        return response.json()

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(get_with_request_id, "parallel-a")
        second = executor.submit(get_with_request_id, "parallel-b")

    assert first.result() == {
        "request_id": "parallel-a",
        "context_request_id": "parallel-a",
    }
    assert second.result() == {
        "request_id": "parallel-b",
        "context_request_id": "parallel-b",
    }
