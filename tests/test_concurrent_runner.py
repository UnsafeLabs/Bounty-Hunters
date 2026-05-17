"""Tests for ConcurrentRunner"""
import pytest, asyncio
from concurrent_runner import ConcurrentRunner
class TestCR:
    @pytest.mark.asyncio
    async def test_semaphore_limit(self):
        runner = ConcurrentRunner(max_concurrent=2); running = [0]; mx = [0]
        async def t(): running[0] += 1; mx[0] = max(mx[0], running[0]); await asyncio.sleep(0.05); running[0] -= 1; return 1
        r = await runner.run([t for _ in range(5)]); assert mx[0] <= 2
    @pytest.mark.asyncio
    async def test_timeout(self):
        r = ConcurrentRunner(max_concurrent=2, default_timeout=0.05); async def s(): await asyncio.sleep(1); return 1
        res = await r.run([s]); assert isinstance(res[0], asyncio.TimeoutError)
    @pytest.mark.asyncio
    async def test_success(self):
        r = ConcurrentRunner(); async def o(): return 42
        res = await r.run([o, o, o]); assert res == [42, 42, 42]
