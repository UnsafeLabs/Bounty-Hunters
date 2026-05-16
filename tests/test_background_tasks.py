"""Tests for BackgroundTasks with exponential backoff"""
import pytest
import asyncio
from background_tasks import BackgroundTasks, TaskResult

class TestBackgroundTasksV2:
    @pytest.mark.asyncio
    async def test_successful_task(self):
        bt = BackgroundTasks(max_retries=2)
        async def good(): return "ok"
        bt.add_task(good)
        results = await bt.run_all()
        assert results[0].success is True
        assert results[0].attempts == 1

    @pytest.mark.asyncio
    async def test_retry_with_backoff(self):
        call_count = 0
        async def flaky():
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise ValueError("fail")
            return "recovered"
        bt = BackgroundTasks(max_retries=3, base_delay=0.01)
        bt.add_task(flaky)
        results = await bt.run_all()
        assert results[0].success is True
        assert call_count == 3

    @pytest.mark.asyncio
    async def test_max_retries_exhausted(self):
        async def always_fail(): raise RuntimeError("always")
        bt = BackgroundTasks(max_retries=1, base_delay=0.01)
        bt.add_task(always_fail)
        results = await bt.run_all()
        assert results[0].success is False
        assert results[0].attempts == 2

    @pytest.mark.asyncio
    async def test_error_callback(self):
        errors = []
        def on_error(result): errors.append(result)
        async def fail(): raise ValueError("test")
        bt = BackgroundTasks(max_retries=0, error_callback=on_error)
        bt.add_task(fail)
        await bt.run_all()
        assert len(errors) == 1
        assert errors[0].success is False

    @pytest.mark.asyncio
    async def test_delay_calculation(self):
        bt = BackgroundTasks(base_delay=1.0, max_delay=10.0)
        assert bt.base_delay == 1.0
        assert bt.max_delay == 10.0
