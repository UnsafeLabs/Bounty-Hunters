import logging
from collections.abc import Callable
from typing import Any

import pytest
from fastapi import BackgroundTasks


@pytest.mark.anyio
async def test_background_task_records_success_result() -> None:
    calls: list[str] = []
    tasks = BackgroundTasks()

    def write_message(message: str) -> None:
        calls.append(message)

    tasks.add_task(write_message, "done")

    await tasks()

    assert calls == ["done"]
    assert tasks.task_results == [
        {
            "task_name": "write_message",
            "status": "success",
            "exception": None,
            "retry_count": 0,
        }
    ]


@pytest.mark.anyio
async def test_background_task_retries_until_success() -> None:
    calls: list[int] = []
    tasks = BackgroundTasks()

    def flaky_task() -> None:
        calls.append(1)
        if len(calls) < 3:
            raise RuntimeError("not yet")

    tasks.add_task(flaky_task, max_retries=3)

    await tasks()

    assert len(calls) == 3
    assert tasks.task_results == [
        {
            "task_name": "flaky_task",
            "status": "success",
            "exception": None,
            "retry_count": 2,
        }
    ]


@pytest.mark.anyio
async def test_background_task_logs_and_calls_error_callback(
    caplog: pytest.LogCaptureFixture,
) -> None:
    calls: list[int] = []
    callback_errors: list[tuple[str, str, int]] = []
    tasks = BackgroundTasks()

    def failing_task() -> None:
        calls.append(1)
        raise RuntimeError("boom")

    async def on_error(exc: Exception, task_info: dict[str, Any]) -> None:
        callback_errors.append(
            (str(exc), str(task_info["name"]), int(task_info["retry_count"]))
        )

    caplog.set_level(logging.ERROR, logger="fastapi")
    tasks.add_task(failing_task, on_error=on_error, max_retries=2)

    await tasks()

    assert len(calls) == 3
    assert callback_errors == [
        ("boom", "failing_task", 0),
        ("boom", "failing_task", 1),
        ("boom", "failing_task", 2),
    ]
    assert tasks.task_results == [
        {
            "task_name": "failing_task",
            "status": "failed",
            "exception": "boom",
            "retry_count": 2,
        }
    ]
    assert "Background task failing_task failed on attempt 1 of 3" in caplog.text
    assert "Background task failing_task failed on attempt 3 of 3" in caplog.text


@pytest.mark.anyio
async def test_background_task_default_failure_still_raises(
    caplog: pytest.LogCaptureFixture,
) -> None:
    tasks = BackgroundTasks()

    def failing_task() -> None:
        raise RuntimeError("default failure")

    caplog.set_level(logging.ERROR, logger="fastapi")
    tasks.add_task(failing_task)

    with pytest.raises(RuntimeError, match="default failure"):
        await tasks()

    assert tasks.task_results == [
        {
            "task_name": "failing_task",
            "status": "failed",
            "exception": "default failure",
            "retry_count": 0,
        }
    ]
    assert "Background task failing_task failed on attempt 1 of 1" in caplog.text


@pytest.mark.anyio
async def test_background_task_preserves_existing_keyword_arguments() -> None:
    calls: list[tuple[str, int]] = []
    tasks = BackgroundTasks()

    def task_with_reserved_names(on_error: str, max_retries: int) -> None:
        calls.append((on_error, max_retries))

    tasks.add_task(task_with_reserved_names, on_error="value", max_retries=5)

    await tasks()

    assert calls == [("value", 5)]
    assert tasks.task_results == [
        {
            "task_name": "task_with_reserved_names",
            "status": "success",
            "exception": None,
            "retry_count": 0,
        }
    ]


@pytest.mark.anyio
async def test_background_task_preserves_callable_on_error_keyword() -> None:
    calls: list[str] = []
    tasks = BackgroundTasks()

    def callback() -> None:
        calls.append("callback")

    def task_with_on_error(on_error: Callable[[], None]) -> None:
        on_error()

    tasks.add_task(task_with_on_error, on_error=callback)

    await tasks()

    assert calls == ["callback"]
    assert tasks.task_results == [
        {
            "task_name": "task_with_on_error",
            "status": "success",
            "exception": None,
            "retry_count": 0,
        }
    ]


def test_background_task_rejects_negative_retries() -> None:
    tasks = BackgroundTasks()

    def task() -> None:
        pass

    with pytest.raises(ValueError, match="max_retries"):
        tasks.add_task(task, max_retries=-1)
