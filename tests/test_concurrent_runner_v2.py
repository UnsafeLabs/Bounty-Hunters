"""Tests for ConcurrentRunner v2"""
import pytest, asyncio
from concurrent_runner_v2 import ConcurrentRunner
class TestCRV2:
    @pytest.mark.asyncio
    async def test_semaphore_limit(self):
        runner = ConcurrentRunner(max_concurrent=2)
        running = [0]; max_running = [0]
        async def task():
            running[0] += 1; max_running[0] = max(max_running[0], running[0])
            await asyncio.sleep(0.05); running[0] -= 1; return 1
        results = await runner.run([task for _ in range(5)])
        assert max_running[0] <= 2
    @pytest.mark.asyncio
    async def test_timeout(self):
        runner = ConcurrentRunner(max_concurrent=2, default_timeout=0.05)
        async def slow(): await asyncio.sleep(1); return 1
        results = await runner.run([slow])
        assert isinstance(results[0], asyncio.TimeoutError)
    @pytest.mark.asyncio
    async def test_success(self):
        runner = ConcurrentRunner()
        async def ok(): return 42
        results = await runner.run([ok, ok, ok])
        assert results == [42, 42, 42]
