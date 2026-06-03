import logging
import uuid
import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from fastapi.middleware.request_id import RequestIDMiddleware
from fastapi.logger import logger

def test_request_id_middleware():
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/")
    def read_root(request: Request):
        assert hasattr(request.state, "request_id")
        assert request.state.request_id is not None
        logger.info("Test log inside request")
        return {"request_id": request.state.request_id}

    client = TestClient(app)

    # 1. Test standard generation and UUID in response header
    response = client.get("/")
    assert response.status_code == 200
    assert "X-Request-ID" in response.headers
    req_id = response.headers["X-Request-ID"]
    assert response.json()["request_id"] == req_id
    val = uuid.UUID(req_id, version=4)
    assert str(val) == req_id

    # 2. Test client-provided X-Request-ID header preservation
    custom_id = "my-custom-request-id-12345"
    response2 = client.get("/", headers={"X-Request-ID": custom_id})
    assert response2.status_code == 200
    assert response2.headers["X-Request-ID"] == custom_id
    assert response2.json()["request_id"] == custom_id

def test_log_correlation(caplog):
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/log")
    def log_endpoint():
        logger.info("Inside log endpoint")
        return {"status": "ok"}

    client = TestClient(app)

    with caplog.at_level(logging.INFO, logger="fastapi"):
        response = client.get("/log")
        assert response.status_code == 200
        req_id = response.headers["X-Request-ID"]
        
        # Verify log message includes the request ID
        log_messages = [record.message for record in caplog.records]
        assert any(req_id in msg for msg in log_messages)

def test_no_middleware_works(caplog):
    app = FastAPI()

    @app.get("/no-middleware")
    def no_middleware_endpoint():
        logger.info("Without middleware log")
        return {"status": "ok"}

    client = TestClient(app)

    with caplog.at_level(logging.INFO, logger="fastapi"):
        response = client.get("/no-middleware")
        assert response.status_code == 200
        assert "X-Request-ID" not in response.headers
        
        log_messages = [record.message for record in caplog.records]
        assert any("Without middleware log" in msg for msg in log_messages)
