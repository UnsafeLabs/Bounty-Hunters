import asyncio
import pytest
from fastapi.concurrency import run_concurrently, ConcurrencyError


@pytest.mark.anyio
async def test_concurrency_limiting_and_sequencing():
    active_count = 0
    max_active = 0

    async def task_fn(delay, val):
        nonlocal active_count, max_active
        active_count += 1
        max_active = max(max_active, active_count)
        await asyncio.sleep(delay)
        active_count -= 1
        return val

    # Test max_concurrency of 1 (sequential)
    coros = [task_fn(0.01, i) for i in range(5)]
    results = await run_concurrently(coros, max_concurrency=1)
    assert results == [0, 1, 2, 3, 4]
    assert max_active == 1

    # Reset metrics
    active_count = 0
    max_active = 0

    # Test max_concurrency of 2
    coros = [task_fn(0.02, i) for i in range(5)]
    results = await run_concurrently(coros, max_concurrency=2)
    assert results == [0, 1, 2, 3, 4]
    assert max_active == 2

    # Reset metrics
    active_count = 0
    max_active = 0

    # Test max_concurrency greater than task count (parallel)
    coros = [task_fn(0.01, i) for i in range(3)]
    results = await run_concurrently(coros, max_concurrency=10)
    assert results == [0, 1, 2]
    assert max_active == 3


@pytest.mark.anyio
async def test_ordering_is_maintained():
    async def fast_task():
        await asyncio.sleep(0.01)
        return "fast"

    async def slow_task():
        await asyncio.sleep(0.05)
        return "slow"

    # Even though fast_task finishes first, the returned list must be in input order
    coros = [slow_task(), fast_task()]
    results = await run_concurrently(coros, max_concurrency=2)
    assert results == ["slow", "fast"]


@pytest.mark.anyio
async def test_error_collection():
    async def success_task(val):
        return val

    async def fail_task(msg):
        raise ValueError(msg)

    coros = [
        success_task("ok1"),
        fail_task("error 1"),
        success_task("ok2"),
        fail_task("error 2"),
    ]

    with pytest.raises(ConcurrencyError) as exc_info:
        await run_concurrently(coros, max_concurrency=2)

    assert len(exc_info.value.failures) == 2
    messages = {str(e) for e in exc_info.value.failures}
    assert "error 1" in messages
    assert "error 2" in messages


@pytest.mark.anyio
async def test_timeout_returns_partial_results_plus_timeout_error():
    async def fast_task(val):
        await asyncio.sleep(0.01)
        return val

    async def slow_task():
        await asyncio.sleep(0.1)
        return "slow"

    coros = [
        fast_task("ok1"),
        slow_task(),
        fast_task("ok2"),
    ]

    # Run with a short timeout
    results = await run_concurrently(coros, max_concurrency=2, timeout=0.03)

    # We expect "ok1" and "ok2" to succeed, while slow_task is cancelled.
    # The return value should be the partial results plus the timeout error.
    assert len(results) == 3
    assert results[0] == "ok1"
    assert results[1] == "ok2"
    assert isinstance(results[2], asyncio.TimeoutError) or isinstance(results[2], Exception)
