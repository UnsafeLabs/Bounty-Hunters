"""Tests for concurrent task runner."""

import asyncio
import pytest
from concurrency import run_concurrently, ConcurrencyError


async def identity(n: int) -> int:
    return n


async def delayed_identity(n: int) -> int:
    await asyncio.sleep(0.01 * n)
    return n


async def failing_task(n: int) -> int:
    if n % 2 == 0:
        raise ValueError(f"Task {n} failed deliberately")
    return n


async def slow_task(n: int) -> int:
    await asyncio.sleep(n)
    return n


class TestRunConcurrently:
    @pytest.mark.asyncio
    async def test_executes_with_concurrency_limit(self):
        coros = [delayed_identity(i) for i in range(8)]
        t0 = asyncio.get_event_loop().time()
        results = await run_concurrently(coros, max_concurrency=2)
        elapsed = asyncio.get_event_loop().time() - t0
        assert results == list(range(8))
        assert elapsed < 0.5

    @pytest.mark.asyncio
    async def test_results_maintain_input_order(self):
        coros = [asyncio.sleep(0.02 * (10 - i), result=i) for i in range(5)]
        results = await run_concurrently(coros, max_concurrency=5)
        assert results == list(range(5))

    @pytest.mark.asyncio
    async def test_concurrency_error_collects_failures(self):
        coros = [failing_task(i) for i in range(6)]
        with pytest.raises(ConcurrencyError) as exc_info:
            await run_concurrently(coros, max_concurrency=3)
        err = exc_info.value
        assert len(err.errors) == 3

    @pytest.mark.asyncio
    async def test_timeout_cancels_remaining(self):
        coros = [slow_task(i) for i in range(3, 6)]
        with pytest.raises(ConcurrencyError) as exc_info:
            await run_concurrently(coros, max_concurrency=5, timeout=0.1)
        err = exc_info.value
        cancelled = [e for _, e in err.errors if isinstance(e, asyncio.TimeoutError)]
        assert len(cancelled) >= 1

    @pytest.mark.asyncio
    async def test_max_concurrency_one_sequential(self):
        coros = [asyncio.sleep(0.01, result=f"task_{i}") for i in range(3)]
        t0 = asyncio.get_event_loop().time()
        results = await run_concurrently(coros, max_concurrency=1)
        elapsed = asyncio.get_event_loop().time() - t0
        assert results == ["task_0", "task_1", "task_2"]
        assert elapsed > 0.02

    @pytest.mark.asyncio
    async def test_max_concurrency_exceeds_task_count(self):
        coros = [identity(i) for i in range(5)]
        results = await run_concurrently(coros, max_concurrency=100)
        assert results == list(range(5))

    @pytest.mark.asyncio
    async def test_empty_coroutines(self):
        results = await run_concurrently([])
        assert results == []

    @pytest.mark.asyncio
    async def test_zero_max_concurrency_raises(self):
        with pytest.raises(ValueError):
            await run_concurrently([identity(1)], max_concurrency=0)