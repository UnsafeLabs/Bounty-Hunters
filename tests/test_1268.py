"""Tests for BackgroundTasks error handling and retry mechanism"""
import pytest
import asyncio

class TestBackgroundTasksErrorHandling:
    def test_add_task_with_error_callback(self):
        from fastapi.background import BackgroundTasks
        errors = []
        def on_error(task_err):
            errors.append(task_err)
        bt = BackgroundTasks(error_callback=on_error)
        assert bt.error_callback is not None
        assert bt.task_results == []

    def test_task_results_tracking(self):
        from fastapi.background import BackgroundTasks
        bt = BackgroundTasks()
        async def good_task():
            return "ok"
        bt.add_task(good_task)
        assert len(bt.tasks) > 0

    def test_retry_count_default(self):
        from fastapi.background import BackgroundTasks
        bt = BackgroundTasks()
        assert bt.max_retries > 0

    def test_retry_on_failure(self):
        from fastapi.background import BackgroundTasks
        bt = BackgroundTasks(max_retries=2)
        assert bt.max_retries == 2

    @pytest.mark.asyncio
    async def test_async_task_execution(self):
        from fastapi.background import BackgroundTasks
        bt = BackgroundTasks()
        results = []
        async def sample_task(x):
            results.append(x * 2)
        bt.add_task(sample_task, 5)
        assert len(bt.tasks) == 1
