"""Tests for enhanced BackgroundTasks with error handling and retry."""
from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

import pytest

from fastapi import BackgroundTasks
from fastapi.background import TaskResult, TaskStatus


# ---------------------------------------------------------------------------
# Helper functions used as background tasks
# ---------------------------------------------------------------------------

def successful_task(results: list, value: str = "ok") -> None:
    results.append(value)


def failing_task(results: list, fail_count: int = 1) -> None:
    """Fails the first `fail_count` calls, then succeeds."""
    if not hasattr(failing_task, "_call_counts"):
        failing_task._call_counts = {}  # type: ignore[attr-defined]
    key = id(results)
    failing_task._call_counts[key] = failing_task._call_counts.get(key, 0) + 1  # type: ignore[attr-defined]
    if failing_task._call_counts[key] <= fail_count:
        raise RuntimeError(f"Simulated failure #{failing_task._call_counts[key]}")
    results.append("recovered")


def always_failing_task() -> None:
    raise ValueError("permanent failure")


async def async_successful_task(results: list) -> None:
    results.append("async_ok")


async def async_failing_task(results: list, fail_count: int = 1) -> None:
    if not hasattr(async_failing_task, "_call_counts"):
        async_failing_task._call_counts = {}  # type: ignore[attr-defined]
    key = id(results)
    async_failing_task._call_counts[key] = async_failing_task._call_counts.get(key, 0) + 1  # type: ignore[attr-defined]
    if async_failing_task._call_counts[key] <= fail_count:
        raise RuntimeError(f"Async failure #{async_failing_task._call_counts[key]}")
    results.append("async_recovered")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestBasicFunctionality:
    """Verify the enhanced BackgroundTasks is backwards-compatible."""

    @pytest.mark.anyio
    async def test_add_and_run_sync_task(self) -> None:
        bt = BackgroundTasks()
        results: list[str] = []
        bt.add_task(successful_task, results, value="hello")
        await bt()
        assert results == ["hello"]

    @pytest.mark.anyio
    async def test_add_and_run_async_task(self) -> None:
        bt = BackgroundTasks()
        results: list[str] = []
        bt.add_task(async_successful_task, results)
        await bt()
        assert results == ["async_ok"]

    @pytest.mark.anyio
    async def test_multiple_tasks(self) -> None:
        bt = BackgroundTasks()
        results: list[str] = []
        bt.add_task(successful_task, results, value="a")
        bt.add_task(successful_task, results, value="b")
        bt.add_task(successful_task, results, value="c")
        await bt()
        assert results == ["a", "b", "c"]


class TestErrorHandling:
    """Verify exceptions are caught and logged."""

    @pytest.mark.anyio
    async def test_failed_task_does_not_raise(self) -> None:
        bt = BackgroundTasks()
        # Should not propagate the exception
        bt.add_task(always_failing_task, max_retries=0)
        await bt()

    @pytest.mark.anyio
    async def test_failed_task_recorded(self) -> None:
        bt = BackgroundTasks()
        bt.add_task(always_failing_task, max_retries=0)
        await bt()
        assert len(bt.task_results) == 1
        result = bt.task_results[0]
        assert result.func_name == "always_failing_task"
        assert result.status == TaskStatus.FAILED
        assert result.error == "permanent failure"
        assert result.retries == 0

    @pytest.mark.anyio
    async def test_successful_task_recorded(self) -> None:
        bt = BackgroundTasks()
        results: list[str] = []
        bt.add_task(successful_task, results, value="ok")
        await bt()
        assert len(bt.task_results) == 1
        assert bt.task_results[0].status == TaskStatus.SUCCESS
        assert bt.task_results[0].retries == 0


class TestRetryMechanism:
    """Verify max_retries works for both sync and async tasks."""

    @pytest.mark.anyio
    async def test_sync_retry_succeeds(self) -> None:
        bt = BackgroundTasks()
        results: list[str] = []
        # Reset call counter
        if hasattr(failing_task, "_call_counts"):
            failing_task._call_counts.clear()  # type: ignore[attr-defined]
        bt.add_task(failing_task, results, fail_count=2, max_retries=3)
        await bt()
        assert "recovered" in results
        # Should have: 2 failures + 1 success
        statuses = [r.status for r in bt.task_results if r.func_name == "failing_task"]
        assert TaskStatus.SUCCESS in statuses

    @pytest.mark.anyio
    async def test_sync_retry_exhausted(self) -> None:
        bt = BackgroundTasks()
        results: list[str] = []
        if hasattr(failing_task, "_call_counts"):
            failing_task._call_counts.clear()  # type: ignore[attr-defined]
        bt.add_task(failing_task, results, fail_count=5, max_retries=2)
        await bt()
        assert "recovered" not in results
        failed = [r for r in bt.task_results if r.status == TaskStatus.FAILED]
        assert len(failed) == 1
        assert failed[0].retries == 2

    @pytest.mark.anyio
    async def test_async_retry_succeeds(self) -> None:
        bt = BackgroundTasks()
        results: list[str] = []
        if hasattr(async_failing_task, "_call_counts"):
            async_failing_task._call_counts.clear()  # type: ignore[attr-defined]
        bt.add_task(async_failing_task, results, fail_count=1, max_retries=2)
        await bt()
        assert "async_recovered" in results

    @pytest.mark.anyio
    async def test_retry_status_tracking(self) -> None:
        bt = BackgroundTasks()
        results: list[str] = []
        if hasattr(failing_task, "_call_counts"):
            failing_task._call_counts.clear()  # type: ignore[attr-defined]
        bt.add_task(failing_task, results, fail_count=2, max_retries=3)
        await bt()
        statuses = [r.status for r in bt.task_results if r.func_name == "failing_task"]
        assert statuses.count(TaskStatus.RETRYING) == 2
        assert statuses.count(TaskStatus.SUCCESS) == 1


class TestErrorCallbacks:
    """Verify per-task and global error callbacks."""

    @pytest.mark.anyio
    async def test_per_task_on_error_callback(self) -> None:
        bt = BackgroundTasks()
        callback = MagicMock()
        bt.add_task(always_failing_task, max_retries=0, on_error=callback)
        await bt()
        callback.assert_called_once()
        name, exc, retries = callback.call_args[0]
        assert name == "always_failing_task"
        assert isinstance(exc, ValueError)
        assert retries == 0

    @pytest.mark.anyio
    async def test_global_error_callback(self) -> None:
        bt = BackgroundTasks()
        callback = MagicMock()
        bt.set_error_callback(callback)
        bt.add_task(always_failing_task, max_retries=0)
        await bt()
        callback.assert_called_once()

    @pytest.mark.anyio
    async def test_per_task_overrides_global(self) -> None:
        bt = BackgroundTasks()
        global_cb = MagicMock()
        local_cb = MagicMock()
        bt.set_error_callback(global_cb)
        bt.add_task(always_failing_task, max_retries=0, on_error=local_cb)
        await bt()
        local_cb.assert_called_once()
        global_cb.assert_not_called()

    @pytest.mark.anyio
    async def test_callback_exception_does_not_propagate(self) -> None:
        bt = BackgroundTasks()

        def bad_callback(name: str, exc: Exception, retries: int) -> None:
            raise RuntimeError("callback blew up")

        bt.set_error_callback(bad_callback)
        bt.add_task(always_failing_task, max_retries=0)
        # Should not raise
        await bt()


class TestTaskResult:
    """Verify TaskResult dataclass fields."""

    def test_task_result_defaults(self) -> None:
        r = TaskResult(func_name="test", status=TaskStatus.PENDING)
        assert r.error is None
        assert r.retries == 0
        assert r.args == ()
        assert r.kwargs == {}

    def test_task_status_enum_values(self) -> None:
        assert TaskStatus.PENDING == "pending"
        assert TaskStatus.SUCCESS == "success"
        assert TaskStatus.FAILED == "failed"
        assert TaskStatus.RETRYING == "retrying"


class TestMultipleTasksInteraction:
    """Verify multiple tasks with mixed success/failure."""

    @pytest.mark.anyio
    async def test_mixed_tasks(self) -> None:
        bt = BackgroundTasks()
        results: list[str] = []
        if hasattr(failing_task, "_call_counts"):
            failing_task._call_counts.clear()  # type: ignore[attr-defined]
        bt.add_task(successful_task, results, value="first")
        bt.add_task(always_failing_task, max_retries=0)
        bt.add_task(successful_task, results, value="last")
        await bt()
        # All three tasks should have run
        assert "first" in results
        assert "last" in results
        assert len(bt.task_results) == 3
        statuses = [r.status for r in bt.task_results]
        assert statuses.count(TaskStatus.SUCCESS) == 2
        assert statuses.count(TaskStatus.FAILED) == 1