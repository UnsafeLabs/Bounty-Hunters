"""Tests for background.py - enhanced BackgroundTasks with error handling and retries."""

import asyncio
import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from fastapi.background import BackgroundTasks, TaskResult
from fastapi.logger import logger as fastapi_logger


class TestTaskResult:
    """Tests for the TaskResult dataclass."""

    def test_success_result(self):
        """Success result should have success=True and no exception."""
        result = TaskResult(
            func_name="test_func",
            success=True,
            message="Completed",
        )
        assert result.func_name == "test_func"
        assert result.success is True
        assert result.exception is None
        assert result.message == "Completed"

    def test_failure_result(self):
        """Failure result should have success=False and exception."""
        exc = ValueError("test error")
        result = TaskResult(
            func_name="test_func",
            success=False,
            exception=exc,
            retry_count=2,
            message="Failed after 2 retries",
        )
        assert result.success is False
        assert result.exception == exc
        assert result.retry_count == 2


class TestBackgroundTasksBasic:
    """Tests for basic background task functionality (backward compatibility)."""

    @pytest.mark.asyncio
    async def test_add_task_basic(self):
        """Basic task should execute without errors."""
        executed = []

        def my_task(value):
            executed.append(value)

        tasks = BackgroundTasks()
        tasks.add_task(my_task, "test_value")

        # Execute the background tasks
        for task in tasks.tasks:
            await task()

        assert executed == ["test_value"]

    @pytest.mark.asyncio
    async def test_add_task_async(self):
        """Async task should execute correctly."""
        executed = []

        async def my_async_task(value):
            await asyncio.sleep(0.01)
            executed.append(value)

        tasks = BackgroundTasks()
        tasks.add_task(my_async_task, "async_value")

        for task in tasks.tasks:
            await task()

        assert executed == ["async_value"]

    @pytest.mark.asyncio
    async def test_task_results_empty_after_success(self):
        """task_results should contain success record after execution."""
        tasks = BackgroundTasks()
        tasks.add_task(lambda: None)

        for task in tasks.tasks:
            await task()

        assert len(tasks.task_results) == 1
        assert tasks.task_results[0].success is True
        assert tasks.task_results[0].func_name == "<lambda>"


class TestBackgroundTasksErrorHandling:
    """Tests for error handling in background tasks."""

    @pytest.mark.asyncio
    async def test_task_exception_logged(self):
        """Task exceptions should be logged and recorded."""
        def failing_task():
            raise ValueError("task failed")

        tasks = BackgroundTasks()
        tasks.add_task(failing_task)

        with patch.object(fastapi_logger, "error") as mock_error:
            for task in tasks.tasks:
                await task()

            mock_error.assert_called_once()
            assert "failing_task" in mock_error.call_args[0][0]

    @pytest.mark.asyncio
    async def test_task_result_records_failure(self):
        """Failed task should be recorded with exception info."""
        def failing_task():
            raise RuntimeError("boom")

        tasks = BackgroundTasks()
        tasks.add_task(failing_task)

        for task in tasks.tasks:
            await task()

        assert len(tasks.task_results) == 1
        result = tasks.task_results[0]
        assert result.success is False
        assert isinstance(result.exception, RuntimeError)
        assert str(result.exception) == "boom"


class TestBackgroundTasksRetry:
    """Tests for the retry mechanism."""

    @pytest.mark.asyncio
    async def test_retry_on_failure(self):
        """Task should retry up to max_retries times."""
        call_count = 0

        def flaky_task():
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise ValueError("not yet")

        tasks = BackgroundTasks()
        tasks.add_task(flaky_task, _max_retries=3)

        for task in tasks.tasks:
            await task()

        # Should have been called 3 times (2 failures + 1 success)
        assert call_count == 3
        assert len(tasks.task_results) == 1
        assert tasks.task_results[0].success is True
        assert tasks.task_results[0].retry_count == 2

    @pytest.mark.asyncio
    async def test_no_retry_when_max_retries_zero(self):
        """Default max_retries=0 means no retries."""
        call_count = 0

        def failing_task():
            nonlocal call_count
            call_count += 1
            raise ValueError("always fails")

        tasks = BackgroundTasks()
        tasks.add_task(failing_task)  # Default _max_retries=0

        for task in tasks.tasks:
            await task()

        assert call_count == 1
        assert tasks.task_results[0].retry_count == 0

    @pytest.mark.asyncio
    async def test_permanent_failure_after_max_retries(self):
        """Task should fail permanently after exhausting retries."""
        def always_fails():
            raise ValueError("never works")

        tasks = BackgroundTasks()
        tasks.add_task(always_fails, _max_retries=2)

        with patch.object(fastapi_logger, "error") as mock_error:
            for task in tasks.tasks:
                await task()

            mock_error.assert_called_once()
            assert "permanently" in mock_error.call_args[0][0].lower()

        assert tasks.task_results[0].success is False
        assert tasks.task_results[0].retry_count == 2


class TestBackgroundTasksErrorCallback:
    """Tests for the error callback mechanism."""

    @pytest.mark.asyncio
    async def test_per_task_error_callback(self):
        """Per-task error callback should be invoked on failure."""
        callback_called = []

        def on_error(exc, func_name):
            callback_called.append((func_name, str(exc)))

        def failing_task():
            raise ValueError("test error")

        tasks = BackgroundTasks()
        tasks.add_task(failing_task, _on_error=on_error)

        for task in tasks.tasks:
            await task()

        assert len(callback_called) == 1
        assert callback_called[0][0] == "failing_task"
        assert "test error" in callback_called[0][1]

    @pytest.mark.asyncio
    async def test_global_error_callback(self):
        """Global error callback should be used when per-task callback is not set."""
        callback_called = []

        def global_on_error(exc, func_name):
            callback_called.append((func_name, str(exc)))

        def failing_task():
            raise ValueError("global error")

        tasks = BackgroundTasks()
        tasks.set_error_callback(global_on_error)
        tasks.add_task(failing_task)  # No _on_error specified

        for task in tasks.tasks:
            await task()

        assert len(callback_called) == 1

    @pytest.mark.asyncio
    async def test_async_error_callback(self):
        """Async error callback should work correctly."""
        callback_called = []

        async def async_on_error(exc, func_name):
            await asyncio.sleep(0.01)
            callback_called.append((func_name, str(exc)))

        def failing_task():
            raise ValueError("async callback")

        tasks = BackgroundTasks()
        tasks.add_task(failing_task, _on_error=async_on_error)

        for task in tasks.tasks:
            await task()

        assert len(callback_called) == 1

    @pytest.mark.asyncio
    async def test_error_callback_exception_handled(self):
        """Exception in error callback should not crash the task handler."""
        def failing_callback(exc, func_name):
            raise RuntimeError("callback crashed")

        def failing_task():
            raise ValueError("original error")

        tasks = BackgroundTasks()
        tasks.add_task(failing_task, _on_error=failing_callback)

        with patch.object(fastapi_logger, "error") as mock_error:
            for task in tasks.tasks:
                await task()

            # Should log that the callback also failed
            assert any("callback" in str(call).lower() for call in mock_error.call_args_list)


class TestBackgroundTasksMultipleTasks:
    """Tests for multiple background tasks."""

    @pytest.mark.asyncio
    async def test_multiple_tasks_all_recorded(self):
        """All task results should be recorded."""
        tasks = BackgroundTasks()
        tasks.add_task(lambda: None)
        tasks.add_task(lambda: None)
        tasks.add_task(lambda: None)

        for task in tasks.tasks:
            await task()

        assert len(tasks.task_results) == 3
        assert all(r.success for r in tasks.task_results)

    @pytest.mark.asyncio
    async def test_mixed_success_and_failure(self):
        """Mixed results should all be recorded correctly."""
        tasks = BackgroundTasks()
        tasks.add_task(lambda: None)  # Success

        def fail():
            raise ValueError("fail")

        tasks.add_task(fail, _max_retries=1)  # Will fail after retry

        for task in tasks.tasks:
            await task()

        assert len(tasks.task_results) == 2
        assert tasks.task_results[0].success is True
        assert tasks.task_results[1].success is False
