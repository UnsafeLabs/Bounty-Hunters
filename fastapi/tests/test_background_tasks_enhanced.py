"""Tests for enhanced BackgroundTasks with error handling, retries, and result tracking."""
import asyncio

import anyio
import pytest
from fastapi import BackgroundTasks
from fastapi.background import TaskResult


@pytest.fixture
def error_callback():
    """Collects (exception, func_name) tuples for verification."""
    errors: list[tuple[Exception, str]] = []

    def _callback(exc: Exception, func_name: str) -> None:
        errors.append((exc, func_name))

    _callback.errors = errors  # type: ignore[attr-defined]
    return _callback


@pytest.fixture
def async_error_callback():
    """Async version of the error callback."""
    errors: list[tuple[Exception, str]] = []

    async def _callback(exc: Exception, func_name: str) -> None:
        errors.append((exc, func_name))

    _callback.errors = errors  # type: ignore[attr-defined]
    return _callback


# --- Basic backward compatibility ---


@pytest.mark.anyio
async def test_add_task_no_error():
    """Existing add_task behavior works without retries or error handling."""
    results = []

    def my_task(val):
        results.append(val)

    bt = BackgroundTasks()
    bt.add_task(my_task, "hello")
    await bt()

    assert results == ["hello"]
    # No task results recorded for basic add_task with max_retries=0 and success
    assert len(bt.task_results) == 1
    assert bt.task_results[0].success is True
    assert bt.task_results[0].func_name == "my_task"
    assert bt.task_results[0].retry_count == 0


@pytest.mark.anyio
async def test_add_task_async_function():
    """Async functions are properly awaited."""
    results = []

    async def my_async_task(val):
        await anyio.sleep(0.01)
        results.append(val)

    bt = BackgroundTasks()
    bt.add_task(my_async_task, "async_hello")
    await bt()

    assert results == ["async_hello"]
    assert bt.task_results[0].success is True


# --- Error handling ---


@pytest.mark.anyio
async def test_exception_caught_and_logged(error_callback):
    """Exceptions in background tasks are caught and logged, not raised."""
    def failing_task():
        raise ValueError("boom")

    bt = BackgroundTasks(error_callback=error_callback)
    bt.add_task(failing_task)
    # Should not raise
    await bt()

    assert len(bt.task_results) == 1
    result = bt.task_results[0]
    assert result.success is False
    assert result.func_name == "failing_task"
    assert isinstance(result.exception, ValueError)
    assert result.exception_message is not None and "boom" in result.exception_message

    # Error callback was invoked
    assert len(error_callback.errors) == 1
    exc, name = error_callback.errors[0]
    assert isinstance(exc, ValueError)
    assert name == "failing_task"


@pytest.mark.anyio
async def test_async_error_callback(async_error_callback):
    """Async error callbacks are properly awaited."""
    def failing_task():
        raise RuntimeError("async-cb-test")

    bt = BackgroundTasks(error_callback=async_error_callback)
    bt.add_task(failing_task)
    await bt()

    assert len(async_error_callback.errors) == 1
    exc, name = async_error_callback.errors[0]
    assert isinstance(exc, RuntimeError)
    assert name == "failing_task"


@pytest.mark.anyio
async def test_no_error_callback_does_not_raise():
    """Without an error callback, exceptions are still caught silently."""
    def failing_task():
        raise KeyError("silent")

    bt = BackgroundTasks()
    bt.add_task(failing_task)
    await bt()  # Should not raise

    assert len(bt.task_results) == 1
    assert bt.task_results[0].success is False


# --- Retry mechanism ---


@pytest.mark.anyio
async def test_retry_succeeds_on_second_attempt():
    """Task that fails once then succeeds on retry."""
    call_count = 0

    def flaky_task():
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise ConnectionError("first attempt fails")

    bt = BackgroundTasks()
    bt.add_task_with_retries(flaky_task, max_retries=2)
    await bt()

    assert call_count == 2
    assert len(bt.task_results) == 1
    assert bt.task_results[0].success is True
    assert bt.task_results[0].retry_count == 0  # successful attempt, retries happened internally


@pytest.mark.anyio
async def test_retry_exhausted(error_callback):
    """Task that fails all retries is recorded as failure."""
    call_count = 0

    def always_fails():
        nonlocal call_count
        call_count += 1
        raise RuntimeError(f"fail #{call_count}")

    bt = BackgroundTasks(error_callback=error_callback)
    bt.add_task_with_retries(always_fails, max_retries=3)
    await bt()

    assert call_count == 4  # 1 initial + 3 retries
    assert len(bt.task_results) == 1
    result = bt.task_results[0]
    assert result.success is False
    assert result.retry_count == 3
    assert isinstance(result.exception, RuntimeError)
    assert len(error_callback.errors) == 1


@pytest.mark.anyio
async def test_retry_with_args_and_kwargs():
    """Retry mechanism preserves function arguments."""
    results = []

    def task_with_args(a, b, key=None):
        results.append((a, b, key))

    bt = BackgroundTasks()
    bt.add_task_with_retries(task_with_args, 1, 2, key="val", max_retries=0)
    await bt()

    assert results == [(1, 2, "val")]


@pytest.mark.anyio
async def test_retry_async_function():
    """Retry works with async task functions."""
    call_count = 0

    async def flaky_async():
        nonlocal call_count
        call_count += 1
        if call_count < 3:
            raise TimeoutError("not yet")

    bt = BackgroundTasks()
    bt.add_task_with_retries(flaky_async, max_retries=5)
    await bt()

    assert call_count == 3
    assert bt.task_results[0].success is True


# --- Task results ---


@pytest.mark.anyio
async def test_task_results_mixed_success_failure():
    """Multiple tasks with mixed outcomes are all tracked."""
    def succeeds():
        pass

    def fails():
        raise ValueError("oops")

    bt = BackgroundTasks()
    bt.add_task(succeeds)
    bt.add_task(fails)
    bt.add_task(succeeds)
    await bt()

    assert len(bt.task_results) == 3
    assert bt.task_results[0].success is True
    assert bt.task_results[1].success is False
    assert bt.task_results[2].success is True


@pytest.mark.anyio
async def test_task_results_empty_on_no_tasks():
    """No tasks means empty results."""
    bt = BackgroundTasks()
    await bt()
    assert bt.task_results == []


# --- Error callback failure handling ---


@pytest.mark.anyio
async def test_error_callback_itself_fails():
    """If the error callback raises, it is caught and logged."""
    def bad_callback(exc, name):
        raise TypeError("callback broke")

    def failing_task():
        raise ValueError("task broke")

    bt = BackgroundTasks(error_callback=bad_callback)
    bt.add_task(failing_task)
    # Should not raise even though both task and callback fail
    await bt()

    assert len(bt.task_results) == 1
    assert bt.task_results[0].success is False


# --- Default behavior preserved ---


@pytest.mark.anyio
async def test_no_error_callback_no_retries_unchanged():
    """Without error_callback, basic add_task behaves exactly as before."""
    results = []

    def simple_task(x, y):
        results.append(x + y)

    bt = BackgroundTasks()
    bt.add_task(simple_task, 3, 4)
    await bt()

    assert results == [7]


@pytest.mark.anyio
async def test_error_callback_default_none():
    """BackgroundTasks() with no arguments has error_callback=None."""
    bt = BackgroundTasks()
    assert bt.error_callback is None
    assert bt.task_results == []
