import logging

from fastapi import BackgroundTasks, FastAPI
from fastapi.testclient import TestClient


def test_successful_task_records_result():
    app = FastAPI()
    captured: list[BackgroundTasks] = []

    def write_ok(value: str) -> None:
        pass

    @app.post("/ok")
    async def ok(background_tasks: BackgroundTasks):
        background_tasks.add_task(write_ok, "hello")
        captured.append(background_tasks)
        return {"status": "ok"}

    client = TestClient(app)
    response = client.post("/ok")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}

    results = captured[0].task_results
    assert len(results) == 1
    assert results[0]["status"] == "success"
    assert results[0]["exception"] is None
    assert results[0]["retry_count"] == 0


def test_failed_task_is_caught_logged_and_recorded(caplog):
    app = FastAPI()
    captured: list[BackgroundTasks] = []

    def always_fails() -> None:
        raise ValueError("boom")

    @app.post("/fail")
    async def fail(background_tasks: BackgroundTasks):
        background_tasks.add_task(always_fails)
        captured.append(background_tasks)
        return {"status": "accepted"}

    client = TestClient(app)
    with caplog.at_level(logging.ERROR, logger="fastapi"):
        response = client.post("/fail")

    assert response.status_code == 200
    assert response.json() == {"status": "accepted"}

    results = captured[0].task_results
    assert len(results) == 1
    assert results[0]["status"] == "failed"
    assert results[0]["exception"] == "boom"
    assert results[0]["retry_count"] == 0
    assert "always_fails" in caplog.text
    assert "boom" in caplog.text


def test_error_callback_receives_exception_and_func_name():
    app = FastAPI()
    callback_calls: list[tuple[Exception, str]] = []
    captured: list[BackgroundTasks] = []

    def on_error(exc: Exception, func_name: str) -> None:
        callback_calls.append((exc, func_name))

    def always_fails() -> None:
        raise RuntimeError("callback-me")

    @app.post("/callback")
    async def with_callback(background_tasks: BackgroundTasks):
        background_tasks.error_callback = on_error
        background_tasks.add_task(always_fails)
        captured.append(background_tasks)
        return {"status": "accepted"}

    client = TestClient(app)
    response = client.post("/callback")
    assert response.status_code == 200

    assert len(callback_calls) == 1
    exc, func_name = callback_calls[0]
    assert isinstance(exc, RuntimeError)
    assert str(exc) == "callback-me"
    assert func_name == "always_fails"
    assert captured[0].task_results[0]["status"] == "failed"


def test_retry_mechanism_succeeds_after_failures():
    app = FastAPI()
    attempts = {"count": 0}
    captured: list[BackgroundTasks] = []

    def flaky() -> None:
        attempts["count"] += 1
        if attempts["count"] < 3:
            raise ConnectionError("transient")

    @app.post("/retry-ok")
    async def retry_ok(background_tasks: BackgroundTasks):
        background_tasks.add_task(flaky, max_retries=2)
        captured.append(background_tasks)
        return {"status": "accepted"}

    client = TestClient(app)
    response = client.post("/retry-ok")
    assert response.status_code == 200
    assert attempts["count"] == 3

    result = captured[0].task_results[0]
    assert result["status"] == "success"
    assert result["exception"] is None
    assert result["retry_count"] == 2


def test_retry_mechanism_exhausts_and_records_failure():
    app = FastAPI()
    attempts = {"count": 0}
    callback_calls: list[tuple[Exception, str]] = []
    captured: list[BackgroundTasks] = []

    def on_error(exc: Exception, func_name: str) -> None:
        callback_calls.append((exc, func_name))

    def always_fails() -> None:
        attempts["count"] += 1
        raise OSError("still broken")

    @app.post("/retry-fail")
    async def retry_fail(background_tasks: BackgroundTasks):
        background_tasks.error_callback = on_error
        background_tasks.add_task(always_fails, max_retries=2)
        captured.append(background_tasks)
        return {"status": "accepted"}

    client = TestClient(app)
    response = client.post("/retry-fail")
    assert response.status_code == 200
    # initial attempt + 2 retries
    assert attempts["count"] == 3

    result = captured[0].task_results[0]
    assert result["status"] == "failed"
    assert result["exception"] == "still broken"
    assert result["retry_count"] == 2
    assert len(callback_calls) == 1
    assert callback_calls[0][1] == "always_fails"


def test_async_background_task_error_handling():
    app = FastAPI()
    captured: list[BackgroundTasks] = []

    async def async_fail() -> None:
        raise ValueError("async boom")

    @app.post("/async-fail")
    async def async_fail_endpoint(background_tasks: BackgroundTasks):
        background_tasks.add_task(async_fail)
        captured.append(background_tasks)
        return {"status": "accepted"}

    client = TestClient(app)
    response = client.post("/async-fail")
    assert response.status_code == 200

    result = captured[0].task_results[0]
    assert result["status"] == "failed"
    assert result["exception"] == "async boom"
    assert result["retry_count"] == 0


def test_multiple_tasks_results_order():
    app = FastAPI()
    captured: list[BackgroundTasks] = []

    def ok_task() -> None:
        return None

    def bad_task() -> None:
        raise ValueError("nope")

    @app.post("/multi")
    async def multi(background_tasks: BackgroundTasks):
        background_tasks.add_task(ok_task)
        background_tasks.add_task(bad_task)
        background_tasks.add_task(ok_task)
        captured.append(background_tasks)
        return {"status": "accepted"}

    client = TestClient(app)
    response = client.post("/multi")
    assert response.status_code == 200

    results = captured[0].task_results
    assert [r["status"] for r in results] == ["success", "failed", "success"]
    assert results[1]["exception"] == "nope"


def test_error_callback_on_constructor():
    calls: list[tuple[Exception, str]] = []

    def on_error(exc: Exception, func_name: str) -> None:
        calls.append((exc, func_name))

    tasks = BackgroundTasks(error_callback=on_error)

    def fails() -> None:
        raise KeyError("missing")

    tasks.add_task(fails)

    import anyio

    anyio.run(tasks)

    assert len(calls) == 1
    assert isinstance(calls[0][0], KeyError)
    assert calls[0][1] == "fails"
    assert tasks.task_results[0]["status"] == "failed"
