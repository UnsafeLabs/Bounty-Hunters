import pytest

from fastapi.background import BackgroundTasks


@pytest.mark.anyio
async def test_background_task_exception_is_logged_and_recorded(caplog):
    def failing_task() -> None:
        raise RuntimeError("task failed")

    background_tasks = BackgroundTasks()
    background_tasks.add_task(failing_task)

    await background_tasks()

    assert background_tasks.task_results == [
        {
            "task": "failing_task",
            "status": "failed",
            "exception_message": "task failed",
            "retry_count": 0,
        }
    ]
    assert "Background task failing_task failed on attempt 1" in caplog.text


@pytest.mark.anyio
async def test_background_task_error_callback_receives_exception_and_task_name():
    callback_calls: list[tuple[Exception, str]] = []

    def failing_task() -> None:
        raise RuntimeError("task failed")

    def error_callback(exc: Exception, task_name: str) -> None:
        callback_calls.append((exc, task_name))

    background_tasks = BackgroundTasks(error_callback=error_callback)
    background_tasks.add_task(failing_task)

    await background_tasks()

    assert len(callback_calls) == 1
    exc, task_name = callback_calls[0]
    assert isinstance(exc, RuntimeError)
    assert str(exc) == "task failed"
    assert task_name == "failing_task"


@pytest.mark.anyio
async def test_background_task_retries_until_success():
    calls = 0

    def flaky_task() -> None:
        nonlocal calls
        calls += 1
        if calls < 3:
            raise RuntimeError("try again")

    background_tasks = BackgroundTasks()
    background_tasks.add_task(flaky_task, max_retries=2)

    await background_tasks()

    assert calls == 3
    assert background_tasks.task_results == [
        {
            "task": "flaky_task",
            "status": "success",
            "exception_message": None,
            "retry_count": 2,
        }
    ]


@pytest.mark.anyio
async def test_background_task_stops_after_max_retries():
    calls = 0

    def failing_task() -> None:
        nonlocal calls
        calls += 1
        raise RuntimeError("still failing")

    background_tasks = BackgroundTasks()
    background_tasks.add_task(failing_task, max_retries=2)

    await background_tasks()

    assert calls == 3
    assert background_tasks.task_results == [
        {
            "task": "failing_task",
            "status": "failed",
            "exception_message": "still failing",
            "retry_count": 2,
        }
    ]


@pytest.mark.anyio
async def test_background_task_async_error_callback_is_awaited():
    callback_calls: list[str] = []

    def failing_task() -> None:
        raise RuntimeError("task failed")

    async def async_error_callback(exc: Exception, task_name: str) -> None:
        callback_calls.append(task_name)

    background_tasks = BackgroundTasks(error_callback=async_error_callback)
    background_tasks.add_task(failing_task)

    await background_tasks()

    assert callback_calls == ["failing_task"]


@pytest.mark.anyio
async def test_background_task_error_callback_called_on_each_failed_attempt():
    callback_calls: list[int] = []
    attempt = 0

    def failing_task() -> None:
        nonlocal attempt
        attempt += 1
        raise RuntimeError(f"fail {attempt}")

    def error_callback(exc: Exception, task_name: str) -> None:
        callback_calls.append(attempt)

    background_tasks = BackgroundTasks(error_callback=error_callback)
    background_tasks.add_task(failing_task, max_retries=2)

    await background_tasks()

    # callback fires once per failed attempt (initial + 2 retries = 3 total)
    assert callback_calls == [1, 2, 3]


@pytest.mark.anyio
async def test_background_task_success_matches_existing_behavior():
    values: list[str] = []

    def successful_task(value: str) -> None:
        values.append(value)

    background_tasks = BackgroundTasks()
    background_tasks.add_task(successful_task, "ok")

    await background_tasks()

    assert values == ["ok"]
    assert background_tasks.task_results == [
        {
            "task": "successful_task",
            "status": "success",
            "exception_message": None,
            "retry_count": 0,
        }
    ]
