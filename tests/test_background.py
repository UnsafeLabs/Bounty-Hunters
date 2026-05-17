"""Tests for BackgroundTasks with retry"""
import pytest, asyncio
from background import BackgroundTasks, TaskResult

class TestBackgroundTasks:
    @pytest.mark.asyncio
    async def test_success(self):
        results = []
        async def task(): results.append(1)
        bg = BackgroundTasks()
        bg.add_task(task)
        await bg()
        assert bg.task_results[0].status == "success"
        assert results == [1]
    
    @pytest.mark.asyncio
    async def test_retry_on_failure(self):
        calls = [0]
        async def flaky():
            calls[0] += 1
            if calls[0] < 3: raise ValueError("boom")
        bg = BackgroundTasks(max_retries=3)
        bg.add_task(flaky)
        await bg()
        assert bg.task_results[0].status == "success"
        assert bg.task_results[0].retries == 2
        assert calls[0] == 3

    @pytest.mark.asyncio
    async def test_error_callback(self):
        cb_calls = []
        def cb(exc, name): cb_calls.append((str(exc), name))
        async def fail(): raise RuntimeError("fail")
        bg = BackgroundTasks(max_retries=1, error_callback=cb)
        bg.add_task(fail)
        await bg()
        assert bg.task_results[0].status == "failed"
        assert len(cb_calls) == 1
        assert cb_calls[0][0] == "fail"

    @pytest.mark.asyncio
    async def test_no_retry_works(self):
        async def ok(): pass
        bg = BackgroundTasks()
        bg.add_task(ok)
        await bg()
        assert bg.task_results[0].status == "success"
