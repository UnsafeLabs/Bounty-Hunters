import asyncio
from unittest.mock import MagicMock

import pytest

from fastapi.background import BackgroundTasks, TaskResult


@pytest.mark.anyio
async def test_successful_task_records_result():
    tasks = BackgroundTasks()
    tasks.add_task(lambda: None)
    await tasks()
    assert len(tasks.task_results) == 1
    assert tasks.task_results[0].status == "success"
    assert tasks.task_results[0].retry_count == 0


@pytest.mark.anyio
async def test_failed_task_records_result():
    tasks = BackgroundTasks()

    def fail():
        raise ValueError("boom")

    tasks.add_task(fail)
    await tasks()
    assert len(tasks.task_results) == 1
    result = tasks.task_results[0]
    assert result.status == "failed"
    assert result.exception_message == "boom"
    assert result.retry_count == 0


@pytest.mark.anyio
async def test_error_callback_invoked():
    tasks = BackgroundTasks()
    callback = MagicMock()

    def fail():
        raise RuntimeError("oops")

    tasks.set_error_callback(callback)
    tasks.add_task(fail)
    await tasks()
    callback.assert_called_once()
    args = callback.call_args[0]
    assert isinstance(args[0], RuntimeError)
    assert args[1] == "fail"


@pytest.mark.anyio
async def test_retry_on_failure():
    attempts = {"count": 0}
    tasks = BackgroundTasks()

    def fail_twice():
        attempts["count"] += 1
        if attempts["count"] < 3:
            raise ValueError("not yet")

    tasks.add_task(fail_twice, max_retries=2)
    await tasks()
    assert len(tasks.task_results) == 1
    assert tasks.task_results[0].status == "success"
    assert tasks.task_results[0].retry_count == 2
    assert attempts["count"] == 3


@pytest.mark.anyio
async def test_retry_exhausted():
    tasks = BackgroundTasks()

    def always_fail():
        raise ValueError("nope")

    tasks.add_task(always_fail, max_retries=3)
    await tasks()
    assert len(tasks.task_results) == 1
    assert tasks.task_results[0].status == "failed"
    assert tasks.task_results[0].retry_count == 3


@pytest.mark.anyio
async def test_async_task_success():
    tasks = BackgroundTasks()

    async def async_work():
        return 42

    tasks.add_task(async_work)
    await tasks()
    assert len(tasks.task_results) == 1
    assert tasks.task_results[0].status == "success"


@pytest.mark.anyio
async def test_async_task_failure_with_retry():
    attempts = {"count": 0}
    tasks = BackgroundTasks()

    async def async_fail():
        attempts["count"] += 1
        if attempts["count"] < 2:
            raise RuntimeError("async error")

    tasks.add_task(async_fail, max_retries=1)
    await tasks()
    assert tasks.task_results[0].status == "success"
    assert tasks.task_results[0].retry_count == 1


@pytest.mark.anyio
async def test_no_callback_no_error():
    tasks = BackgroundTasks()

    def fail():
        raise ValueError("silent")

    tasks.add_task(fail)
    await tasks()
    assert len(tasks.task_results) == 1
    assert tasks.task_results[0].status == "failed"


@pytest.mark.anyio
async def test_error_callback_exception_is_caught():
    tasks = BackgroundTasks()

    def bad_callback(exc, name):
        raise RuntimeError("callback also fails")

    def fail():
        raise ValueError("task fails")

    tasks.set_error_callback(bad_callback)
    tasks.add_task(fail)
    await tasks()
    assert len(tasks.task_results) == 1
    assert tasks.task_results[0].status == "failed"


@pytest.mark.anyio
async def test_multiple_tasks():
    tasks = BackgroundTasks()
    tasks.add_task(lambda: None)
    tasks.add_task(lambda: 1 / 0)
    tasks.add_task(lambda: None, max_retries=2)
    await tasks()
    assert len(tasks.task_results) == 3
    assert tasks.task_results[0].status == "success"
    assert tasks.task_results[1].status == "failed"
    assert tasks.task_results[2].status == "success"
