import asyncio
import logging

from fastapi import BackgroundTasks


def test_background_task_failure_is_logged_recorded_and_does_not_stop_queue(
    caplog,
) -> None:
    events: list[str] = []
    tasks = BackgroundTasks()

    def failing_task() -> None:
        events.append("failed")
        raise RuntimeError("boom")

    def later_task() -> None:
        events.append("later")

    tasks.add_task(failing_task)
    tasks.add_task(later_task)

    with caplog.at_level(logging.ERROR, logger="fastapi"):
        asyncio.run(tasks())

    assert events == ["failed", "later"]
    assert "Background task failing_task failed" in caplog.text
    assert tasks.task_results[0]["status"] == "failed"
    assert tasks.task_results[0]["task_name"] == "failing_task"
    assert tasks.task_results[0]["exception"] == "boom"
    assert tasks.task_results[0]["retry_count"] == 0
    assert tasks.task_results[1]["status"] == "success"
    assert tasks.task_results[1]["exception"] is None


def test_background_task_retries_and_invokes_error_callback() -> None:
    attempts = 0
    callback_calls: list[tuple[str, str, int]] = []
    tasks = BackgroundTasks()

    def flaky_task() -> None:
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            raise ValueError(f"attempt {attempts}")

    def on_error(exc: Exception, task_name: str, retry_count: int) -> None:
        callback_calls.append((str(exc), task_name, retry_count))

    tasks.add_task(flaky_task, max_retries=2, on_error=on_error)

    asyncio.run(tasks())

    assert attempts == 3
    assert callback_calls == [
        ("attempt 1", "flaky_task", 0),
        ("attempt 2", "flaky_task", 1),
    ]
    assert tasks.task_results == [
        {
            "status": "success",
            "task_name": "flaky_task",
            "exception": None,
            "retry_count": 2,
        }
    ]


def test_background_task_records_retry_count_when_retries_are_exhausted() -> None:
    attempts = 0
    tasks = BackgroundTasks()

    def always_fails() -> None:
        nonlocal attempts
        attempts += 1
        raise RuntimeError("still broken")

    tasks.add_task(always_fails, max_retries=1)

    asyncio.run(tasks())

    assert attempts == 2
    assert tasks.task_results == [
        {
            "status": "failed",
            "task_name": "always_fails",
            "exception": "still broken",
            "retry_count": 1,
        }
    ]


def test_background_task_preserves_existing_args_and_kwargs_behavior() -> None:
    captured: list[tuple[str, str]] = []
    tasks = BackgroundTasks()

    async def collect(prefix: str, *, value: str) -> None:
        captured.append((prefix, value))

    tasks.add_task(collect, "hello", value="world")

    asyncio.run(tasks())

    assert captured == [("hello", "world")]
    assert tasks.task_results == [
        {
            "status": "success",
            "task_name": "collect",
            "exception": None,
            "retry_count": 0,
        }
    ]
