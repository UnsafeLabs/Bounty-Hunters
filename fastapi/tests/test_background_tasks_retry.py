import logging

import pytest
from fastapi import BackgroundTasks


@pytest.mark.anyio
async def test_successful_background_task_records_result():
    tasks = BackgroundTasks()
    calls: list[str] = []

    def write_message(message: str) -> None:
        calls.append(message)

    tasks.add_task(write_message, "sent")

    await tasks()

    assert calls == ["sent"]
    assert tasks.task_results == [
        {
            "task_name": "write_message",
            "status": "success",
            "exception": None,
            "retry_count": 0,
        }
    ]


@pytest.mark.anyio
async def test_failed_background_task_is_logged_and_callback_receives_task_info(
    caplog,
):
    tasks = BackgroundTasks()
    errors: list[tuple[str, str]] = []

    def failing_task() -> None:
        raise RuntimeError("boom")

    def on_error(exc: Exception, task_name: str) -> None:
        errors.append((str(exc), task_name))

    tasks.add_task(failing_task, on_error=on_error)

    with caplog.at_level(logging.ERROR, logger="fastapi"):
        await tasks()

    assert errors == [("boom", "failing_task")]
    assert "Background task failing_task failed after 0 retries" in caplog.text
    assert tasks.task_results == [
        {
            "task_name": "failing_task",
            "status": "failed",
            "exception": "boom",
            "retry_count": 0,
        }
    ]


@pytest.mark.anyio
async def test_background_task_retries_until_success():
    tasks = BackgroundTasks()
    attempts: list[int] = []

    def flaky_task() -> None:
        attempts.append(len(attempts))
        if len(attempts) < 3:
            raise RuntimeError("try again")

    tasks.add_task(flaky_task, max_retries=2)

    await tasks()

    assert attempts == [0, 1, 2]
    assert tasks.task_results == [
        {
            "task_name": "flaky_task",
            "status": "success",
            "exception": None,
            "retry_count": 2,
        }
    ]


@pytest.mark.anyio
async def test_background_task_records_retry_exhaustion():
    tasks = BackgroundTasks()
    attempts: list[int] = []

    def failing_task() -> None:
        attempts.append(len(attempts))
        raise RuntimeError("still failing")

    tasks.add_task(failing_task, max_retries=1)

    await tasks()

    assert attempts == [0, 1]
    assert tasks.task_results == [
        {
            "task_name": "failing_task",
            "status": "failed",
            "exception": "still failing",
            "retry_count": 1,
        }
    ]


@pytest.mark.anyio
async def test_failed_task_does_not_stop_later_background_tasks():
    tasks = BackgroundTasks()
    calls: list[str] = []

    def failing_task() -> None:
        calls.append("first")
        raise RuntimeError("failed")

    def succeeding_task() -> None:
        calls.append("second")

    tasks.add_task(failing_task)
    tasks.add_task(succeeding_task)

    await tasks()

    assert calls == ["first", "second"]
    assert [result["status"] for result in tasks.task_results] == [
        "failed",
        "success",
    ]


@pytest.mark.anyio
async def test_async_error_callback_is_supported():
    tasks = BackgroundTasks()
    errors: list[tuple[str, str]] = []

    def failing_task() -> None:
        raise RuntimeError("async callback")

    async def on_error(exc: Exception, task_name: str) -> None:
        errors.append((str(exc), task_name))

    tasks.add_task(failing_task, on_error=on_error)

    await tasks()

    assert errors == [("async callback", "failing_task")]


def test_negative_max_retries_raises_value_error():
    tasks = BackgroundTasks()

    def task() -> None:
        pass  # pragma: no cover

    with pytest.raises(ValueError, match="max_retries"):
        tasks.add_task(task, max_retries=-1)
