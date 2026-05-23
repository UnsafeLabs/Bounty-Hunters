import logging
import uuid
import pytest
from fastapi import FastAPI, Request
from fastapi.middleware.request_id import RequestIDMiddleware
from fastapi.logger import logger, request_id_ctx
from fastapi.testclient import TestClient

app = FastAPI()
app.add_middleware(RequestIDMiddleware)

@app.get("/")
def read_root():
    logger.info("Test log")
    return {"req_id": request_id_ctx.get()}

client = TestClient(app)

def test_request_id_generated():
    response = client.get("/")
    assert response.status_code == 200
    assert "X-Request-ID" in response.headers
    req_id = response.headers["X-Request-ID"]
    assert response.json() == {"req_id": req_id}

def test_client_provided_request_id():
    custom_id = "test-custom-id"
    response = client.get("/", headers={"X-Request-ID": custom_id})
    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == custom_id
    assert response.json() == {"req_id": custom_id}

def test_logger_includes_request_id(caplog):
    with caplog.at_level(logging.INFO):
        response = client.get("/")
        req_id = response.headers["X-Request-ID"]
        found = False
        for record in caplog.records:
            if hasattr(record, "request_id") and record.request_id == req_id:
                found = True
        assert found
