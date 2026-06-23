"""Tests for error handling and the retry mechanism in ``BackgroundTasks``.

These cover issue #760: background task exceptions must be caught and logged
(instead of silently failing), an optional ``error_callback`` is invoked with the
exception and the original task function name, ``max_retries`` re-executes failed
tasks, and ``task_results`` records the outcome of each task.
"""

import logging

import anyio
import pytest
from fastapi import BackgroundTasks, FastAPI
from fastapi.testclient import TestClient


def test_existing_behavior_without_callback_or_retries_is_unchanged():
    """A successful task runs exactly as before, with no extra configuration."""
    state = {}
    app = FastAPI()

    def write(value):
        state["written"] = value

    holder = {}

    @app.post("/run")
    async def run(background_tasks: BackgroundTasks):
        background_tasks.add_task(write, "done")
        holder["bt"] = background_tasks
        return {"ok": True}

    client = TestClient(app)
    resp = client.post("/run")

    assert resp.status_code == 200
    assert state["written"] == "done"
    assert holder["bt"].task_results == [
        {"task": "write", "status": "success", "exception": None, "retries": 0}
    ]


def test_failed_task_is_caught_logged_and_records_result(caplog):
    """A raising task does not propagate; it is logged, the callback fires, and
    the failure is recorded in ``task_results``."""
    errors = []
    holder = {}
    app = FastAPI()

    def boom():
        raise RuntimeError("kaboom")

    def on_error(exc, name):
        errors.append((type(exc).__name__, str(exc), name))

    @app.post("/run")
    async def run(background_tasks: BackgroundTasks):
        background_tasks.error_callback = on_error
        background_tasks.add_task(boom)
        holder["bt"] = background_tasks
        return {"ok": True}

    client = TestClient(app)
    with caplog.at_level(logging.ERROR, logger="fastapi"):
        resp = client.post("/run")

    # The exception is swallowed: the request still completes successfully.
    assert resp.status_code == 200
    assert errors == [("RuntimeError", "kaboom", "boom")]
    assert holder["bt"].task_results == [
        {"task": "boom", "status": "failed", "exception": "kaboom", "retries": 0}
    ]
    assert any(record.levelno == logging.ERROR for record in caplog.records)
    assert "boom" in caplog.text


def test_retry_succeeds_after_transient_failures():
    """A task that fails a couple of times then succeeds is retried up to
    ``max_retries`` and ends as a success."""
    attempts = {"n": 0}
    holder = {}
    app = FastAPI()

    def flaky():
        attempts["n"] += 1
        if attempts["n"] < 3:
            raise ValueError(f"fail {attempts['n']}")

    @app.post("/run")
    async def run(background_tasks: BackgroundTasks):
        background_tasks.add_task(flaky, max_retries=5)
        holder["bt"] = background_tasks
        return {"ok": True}

    client = TestClient(app)
    resp = client.post("/run")

    assert resp.status_code == 200
    assert attempts["n"] == 3  # 1 initial attempt + 2 retries until success
    assert holder["bt"].task_results == [
        {"task": "flaky", "status": "success", "exception": None, "retries": 2}
    ]


def test_retry_exhausted_records_failure_and_invokes_callback_each_attempt():
    """When every attempt fails, the result is a failure with the retry count and
    the callback is invoked once per failed attempt."""
    calls = []
    holder = {}
    app = FastAPI()

    def always_fail():
        raise RuntimeError("nope")

    def on_error(exc, name):
        calls.append(name)

    @app.post("/run")
    async def run(background_tasks: BackgroundTasks):
        background_tasks.error_callback = on_error
        background_tasks.add_task(always_fail, max_retries=2)
        holder["bt"] = background_tasks
        return {"ok": True}

    client = TestClient(app)
    resp = client.post("/run")

    assert resp.status_code == 200
    assert holder["bt"].task_results == [
        {"task": "always_fail", "status": "failed", "exception": "nope", "retries": 2}
    ]
    # 1 initial attempt + 2 retries == 3 invocations of the error callback.
    assert calls == ["always_fail", "always_fail", "always_fail"]


def test_negative_max_retries_is_rejected():
    background_tasks = BackgroundTasks()
    with pytest.raises(ValueError):
        background_tasks.add_task(lambda: None, max_retries=-1)


def test_call_records_mixed_results_for_multiple_tasks():
    """Directly exercising ``__call__`` records one entry per task, in order."""
    ran = []

    def ok():
        ran.append("ok")

    def bad():
        raise RuntimeError("x")

    background_tasks = BackgroundTasks()
    background_tasks.add_task(ok)
    background_tasks.add_task(bad, max_retries=1)

    anyio.run(background_tasks)

    assert ran == ["ok"]
    assert background_tasks.task_results == [
        {"task": "ok", "status": "success", "exception": None, "retries": 0},
        {"task": "bad", "status": "failed", "exception": "x", "retries": 1},
    ]
