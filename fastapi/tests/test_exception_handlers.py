import pytest
from fastapi import Depends, FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from starlette.responses import JSONResponse


def http_exception_handler(request, exception):
    return JSONResponse({"exception": "http-exception"})


def request_validation_exception_handler(request, exception):
    return JSONResponse({"exception": "request-validation"})


def server_error_exception_handler(request, exception):
    return JSONResponse(status_code=500, content={"exception": "server-error"})


app = FastAPI(
    exception_handlers={
        HTTPException: http_exception_handler,
        RequestValidationError: request_validation_exception_handler,
        Exception: server_error_exception_handler,
    }
)

client = TestClient(app)


def raise_value_error():
    raise ValueError()


def dependency_with_yield():
    yield raise_value_error()


@app.get("/dependency-with-yield", dependencies=[Depends(dependency_with_yield)])
def with_yield(): ...


@app.get("/http-exception")
def route_with_http_exception():
    raise HTTPException(status_code=400)


@app.get("/request-validation/{param}/")
def route_with_request_validation_exception(param: int):
    pass  # pragma: no cover


@app.get("/server-error")
def route_with_server_error():
    raise RuntimeError("Oops!")


def test_override_http_exception():
    response = client.get("/http-exception")
    assert response.status_code == 200
    assert response.json() == {"exception": "http-exception"}


def test_override_request_validation_exception():
    response = client.get("/request-validation/invalid")
    assert response.status_code == 200
    assert response.json() == {"exception": "request-validation"}


def test_override_server_error_exception_raises():
    with pytest.raises(RuntimeError):
        client.get("/server-error")


def test_override_server_error_exception_response():
    client = TestClient(app, raise_server_exceptions=False)
    response = client.get("/server-error")
    assert response.status_code == 500
    assert response.json() == {"exception": "server-error"}


def test_traceback_for_dependency_with_yield():
    client = TestClient(app, raise_server_exceptions=True)
    with pytest.raises(ValueError) as exc_info:
        client.get("/dependency-with-yield")
    last_frame = exc_info.traceback[-1]
    assert str(last_frame.path) == __file__
    assert last_frame.lineno == raise_value_error.__code__.co_firstlineno

def test_default_request_validation_exception_handler():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from pydantic import BaseModel

    app = FastAPI(debug=True)
    
    class Item(BaseModel):
        name: str
        password: str
        nested: dict

    @app.post("/items/")
    def create_item(item: Item):
        return item

    client = TestClient(app)
    
    # Invalid data to trigger validation error
    response = client.post("/items/", json={"name": "test", "password": "supersecret", "nested": {"token": "123", "public": "ok"}})
    assert response.status_code == 422
    data = response.json()
    assert data["path"] == "/items/"
    assert data["method"] == "POST"
    assert "body" in data
    assert data["body"]["password"] == "***REDACTED***"
    assert data["body"]["nested"]["token"] == "***REDACTED***"
    assert data["body"]["nested"]["public"] == "ok"
    assert data["body"]["name"] == "test"

    # Now test without debug mode
    app_no_debug = FastAPI(debug=False)
    @app_no_debug.post("/items/")
    def create_item_no_debug(item: Item):
        return item
        
    client_no_debug = TestClient(app_no_debug)
    response_no_debug = client_no_debug.post("/items/", json={"name": "test", "password": "supersecret", "nested": {"token": "123", "public": "ok"}})
    assert response_no_debug.status_code == 422
    data_no_debug = response_no_debug.json()
    assert "body" not in data_no_debug
    assert data_no_debug["path"] == "/items/"
    assert data_no_debug["method"] == "POST"

