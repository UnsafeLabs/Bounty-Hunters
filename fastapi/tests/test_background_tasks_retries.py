import asyncio
import logging
from typing import Any

import pytest
from fastapi import BackgroundTasks, FastAPI
from fastapi.testclient import TestClient


def run_background_tasks(tasks: BackgroundTasks) -> None:
    asyncio.run(tasks())


def test_successful_background_task_records_result():
    events: list[str] = []
    tasks = BackgroundTasks()

    def write_event(value: str) -> None:
        events.append(value)

    tasks.add_task(write_event, "sent")
    run_background_tasks(tasks)

    assert events == ["sent"]
    assert tasks.task_results == [
        {
            "task_name": "write_event",
            "status": "success",
            "exception": None,
            "retry_count": 0,
        }
    ]


def test_background_task_exception_is_logged_and_recorded(caplog: pytest.LogCaptureFixture):
    errors: list[tuple[str, str, int]] = []
    tasks = BackgroundTasks()

    def failing_task() -> None:
        raise RuntimeError("boom")

    def on_error(exc: Exception, task_info: dict[str, Any]) -> None:
        errors.append(
            (str(exc), task_info["task_name"], task_info["retry_count"])
        )

    tasks.add_task(failing_task, on_error=on_error)

    with caplog.at_level(logging.ERROR, logger="fastapi"):
        run_background_tasks(tasks)

    assert "Background task failing_task failed on attempt 1" in caplog.text
    assert errors == [("boom", "failing_task", 0)]
    assert tasks.task_results == [
        {
            "task_name": "failing_task",
            "status": "failed",
            "exception": "boom",
            "retry_count": 0,
        }
    ]


def test_default_background_task_failure_is_still_raised_for_compatibility(
    caplog: pytest.LogCaptureFixture,
):
    tasks = BackgroundTasks()

    def failing_task() -> None:
        raise RuntimeError("unchanged")

    tasks.add_task(failing_task)

    with caplog.at_level(logging.ERROR, logger="fastapi"):
        with pytest.raises(RuntimeError, match="unchanged"):
            run_background_tasks(tasks)

    assert "Background task failing_task failed on attempt 1" in caplog.text
    assert tasks.task_results == [
        {
            "task_name": "failing_task",
            "status": "failed",
            "exception": "unchanged",
            "retry_count": 0,
        }
    ]


def test_background_task_retries_until_success():
    calls: list[int] = []
    errors: list[int] = []
    tasks = BackgroundTasks()

    def flaky_task() -> None:
        calls.append(1)
        if len(calls) < 3:
            raise RuntimeError(f"failure {len(calls)}")

    def on_error(exc: Exception, task_info: dict[str, Any]) -> None:
        errors.append(task_info["retry_count"])

    tasks.add_task(flaky_task, on_error=on_error, max_retries=2)
    run_background_tasks(tasks)

    assert len(calls) == 3
    assert errors == [0, 1]
    assert tasks.task_results == [
        {
            "task_name": "flaky_task",
            "status": "success",
            "exception": None,
            "retry_count": 2,
        }
    ]


def test_background_task_stops_after_max_retries():
    calls: list[int] = []
    tasks = BackgroundTasks()

    def always_fails() -> None:
        calls.append(1)
        raise RuntimeError("still failing")

    tasks.add_task(always_fails, max_retries=2)
    run_background_tasks(tasks)

    assert len(calls) == 3
    assert tasks.task_results == [
        {
            "task_name": "always_fails",
            "status": "failed",
            "exception": "still failing",
            "retry_count": 2,
        }
    ]


def test_async_error_callback_is_supported():
    errors: list[tuple[str, str]] = []
    tasks = BackgroundTasks()

    def failing_task() -> None:
        raise RuntimeError("async callback")

    async def on_error(exc: Exception, task_info: dict[str, Any]) -> None:
        errors.append((str(exc), task_info["task_name"]))

    tasks.add_task(failing_task, on_error=on_error)
    run_background_tasks(tasks)

    assert errors == [("async callback", "failing_task")]


def test_negative_max_retries_is_rejected():
    tasks = BackgroundTasks()

    with pytest.raises(ValueError, match="max_retries"):
        tasks.add_task(lambda: None, max_retries=-1)


def test_existing_task_kwargs_named_like_retry_options_are_preserved():
    captured: list[Any] = []
    tasks = BackgroundTasks()

    def task_with_retry_kwargs(max_retries: int, on_error: str) -> None:
        captured.append((max_retries, on_error))

    tasks.add_task(task_with_retry_kwargs, max_retries=3, on_error="passthrough")
    run_background_tasks(tasks)

    assert captured == [(3, "passthrough")]
    assert tasks.task_results[0]["status"] == "success"


def test_fastapi_route_continues_when_background_task_failure_is_handled():
    app = FastAPI()
    state: dict[str, Any] = {}
    errors: list[str] = []

    def failing_task() -> None:
        raise RuntimeError("route failure")

    def on_error(exc: Exception, task_info: dict[str, Any]) -> None:
        errors.append(f"{task_info['task_name']}: {exc}")

    @app.get("/background-error")
    def background_error(background_tasks: BackgroundTasks):
        state["tasks"] = background_tasks
        background_tasks.add_task(failing_task, on_error=on_error)
        return {"ok": True}

    client = TestClient(app)
    response = client.get("/background-error")

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert errors == ["failing_task: route failure"]
    assert state["tasks"].task_results == [
        {
            "task_name": "failing_task",
            "status": "failed",
            "exception": "route failure",
            "retry_count": 0,
        }
    ]
